package local.streaming.catalog;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.listener.DefaultErrorHandler;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.util.backoff.FixedBackOff;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.security.MessageDigest;
import java.time.*;
import java.util.*;
import java.util.concurrent.TimeUnit;

@Component
class Store {
    final JdbcTemplate db; final ObjectMapper json;
    Store(JdbcTemplate db,ObjectMapper json){this.db=db;this.json=json;}
    Map<String,Object> decode(String value){try{return json.readValue(value,new TypeReference<>(){});}catch(Exception e){throw new IllegalStateException("Invalid stored JSON",e);}}
    String encode(Object value){try{return json.writeValueAsString(value);}catch(Exception e){throw new IllegalStateException("Cannot encode",e);}}
    Map<String,Object> get(String id){var rows=db.query("SELECT body::text FROM titles WHERE id=?",(r,n)->decode(r.getString(1)),id);if(rows.isEmpty())throw new ResponseStatusException(HttpStatus.NOT_FOUND);return rows.getFirst();}
    @Transactional
    public Map<String,Object> create(Map<String,Object> body){var value=Policy.validate(body);String id=UUID.randomUUID().toString();value.putAll(Map.of("id",id,"version",1,"published",false,"deleted",false));db.update("INSERT INTO titles(id,version,body) VALUES (?,1,?::jsonb)",id,encode(value));outbox(value);return value;}
    @Transactional
    public Map<String,Object> mutate(String id,String etag,Map<String,Object> input,String action){
        var rows=db.query("SELECT body::text FROM titles WHERE id=? FOR UPDATE",(r,n)->decode(r.getString(1)),id);if(rows.isEmpty())throw new ResponseStatusException(HttpStatus.NOT_FOUND);var old=rows.getFirst();long version=((Number)old.get("version")).longValue();
        if(etag==null)throw new ResponseStatusException(HttpStatus.PRECONDITION_REQUIRED,"If-Match required");if(!etag.equals("\""+version+"\""))throw new ResponseStatusException(HttpStatus.PRECONDITION_FAILED);
        if(Boolean.TRUE.equals(old.get("deleted")))throw new ResponseStatusException(HttpStatus.GONE);
        Map<String,Object> value=new LinkedHashMap<>(old);if(input!=null)value.putAll(Policy.validate(input));
        if(action!=null){switch(action){case "publish"->value.put("published",true);case "unpublish"->value.put("published",false);case "delete"->{value.put("deleted",true);value.put("published",false);}default->throw new ResponseStatusException(HttpStatus.NOT_FOUND);}}
        value.put("version",version+1);db.update("UPDATE titles SET version=?,body=?::jsonb,updated_at=now() WHERE id=?",version+1,encode(value),id);outbox(value);return value;
    }
    void outbox(Map<String,Object> value){String id=UUID.randomUUID().toString();var envelope=Map.of("specversion","1.0","id",id,"source","catalog-write","type","TitleChanged","subject",value.get("id"),"version",value.get("version"),"time",Instant.now().toString(),"data",value);db.update("INSERT INTO outbox(id,aggregate_id,version,topic,payload) VALUES (?,?,?,'catalog.title.v1',?::jsonb)",id,value.get("id"),value.get("version"),encode(envelope));}
}

@Component
class Context {
    final Store store;final HttpClient client=HttpClient.newBuilder().connectTimeout(Duration.ofMillis(800)).build();
    Context(Store store){this.store=store;}
    void internal(HttpServletRequest req){String key=System.getenv("SERVICE_KEY"),provided=Objects.toString(req.getHeader("X-Service-Key"),"");if(!MessageDigest.isEqual(key.getBytes(),provided.getBytes()))throw new ResponseStatusException(HttpStatus.FORBIDDEN);}
    Map<String,Object> profile(HttpServletRequest request){
        try{var req=HttpRequest.newBuilder(URI.create(System.getenv("PROFILE_URL")+"/internal/context")).timeout(Duration.ofMillis(800)).header("Authorization",Objects.toString(request.getHeader("Authorization"),"")).header("X-Profile-Token",Objects.toString(request.getHeader("X-Profile-Token"),"")).header("X-Service-Key",System.getenv("SERVICE_KEY")).GET().build();var response=client.send(req,HttpResponse.BodyHandlers.ofString());if(response.statusCode()!=200)throw new ResponseStatusException(response.statusCode()==401?HttpStatus.UNAUTHORIZED:response.statusCode()==403?HttpStatus.FORBIDDEN:HttpStatus.SERVICE_UNAVAILABLE);return store.decode(response.body());}catch(ResponseStatusException e){throw e;}catch(Exception e){throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"Profile authority unavailable");}
    }
    boolean eligible(Map<String,Object> title,Map<String,Object> ctx){return Policy.eligible(title,(String)ctx.get("region"),((Number)ctx.get("maturity")).intValue(),Instant.now());}
    void admin(Jwt jwt){Map<String,Object> realm=jwt.getClaim("realm_access");if(realm==null||!(realm.get("roles") instanceof List<?> roles)||!roles.contains("catalog-admin"))throw new ResponseStatusException(HttpStatus.FORBIDDEN);}
}

@RestController
class Health {
    final Store store;Health(Store store){this.store=store;}
    @GetMapping("/health/live") Object live(){return Map.of("status","ok");}
    @GetMapping("/health/ready") Object ready(){store.db.queryForObject("SELECT 1",Integer.class);return live();}
}

@RestController
@ConditionalOnProperty(name="spring.application.name",havingValue="catalog-write")
class WriteApi {
    final Store store;final Context context;WriteApi(Store store,Context context){this.store=store;this.context=context;}
    ResponseEntity<?> entity(Map<String,Object> body,HttpStatus status){return ResponseEntity.status(status).eTag(body.get("version").toString()).body(body);}
    @PostMapping("/admin/catalog/titles") Object create(@RequestBody Map<String,Object> body,@AuthenticationPrincipal Jwt jwt){context.admin(jwt);return entity(store.create(body),HttpStatus.CREATED);}
    @GetMapping("/admin/catalog/titles/{id}") Object read(@PathVariable String id,@AuthenticationPrincipal Jwt jwt){context.admin(jwt);return entity(store.get(id),HttpStatus.OK);}
    @PutMapping("/admin/catalog/titles/{id}") Object update(@PathVariable String id,@RequestHeader(value="If-Match",required=false) String etag,@RequestBody Map<String,Object> body,@AuthenticationPrincipal Jwt jwt){context.admin(jwt);return entity(store.mutate(id,etag,body,null),HttpStatus.OK);}
    @PostMapping("/admin/catalog/titles/{id}/{action}") Object action(@PathVariable String id,@PathVariable String action,@RequestHeader(value="If-Match",required=false) String etag,@AuthenticationPrincipal Jwt jwt){context.admin(jwt);return entity(store.mutate(id,etag,null,action),HttpStatus.OK);}
    @DeleteMapping("/admin/catalog/titles/{id}") Object delete(@PathVariable String id,@RequestHeader(value="If-Match",required=false) String etag,@AuthenticationPrincipal Jwt jwt){context.admin(jwt);return entity(store.mutate(id,etag,null,"delete"),HttpStatus.OK);}
    @PostMapping("/internal/authorize") Object authorize(@RequestBody Map<String,String> body,HttpServletRequest req){context.internal(req);var ctx=context.profile(req);var title=store.get(body.get("titleId"));if(!context.eligible(title,ctx))throw new ResponseStatusException(HttpStatus.FORBIDDEN,"Content not eligible");return Map.of("titleId",title.get("id"),"assetPath",title.get("assetPath"),"durationSeconds",title.get("durationSeconds"),"allowedUntil",title.get("licenseEnd"),"maxQuality",title.get("maxQuality"),"version",title.get("version"));}
}

@RestController
@ConditionalOnProperty(name="spring.application.name",havingValue="catalog-read")
class ReadApi {
    final Store store;final Context context;ReadApi(Store store,Context context){this.store=store;this.context=context;}
    @GetMapping({"/catalog/titles","/catalog/search"}) Object browse(@RequestParam(defaultValue="") String q,@RequestParam(defaultValue="20") int limit,@RequestParam(defaultValue="0") int offset,HttpServletRequest req){
        if(limit<1||limit>100||offset<0||offset>10000||q.length()>200)throw new ResponseStatusException(HttpStatus.BAD_REQUEST);var ctx=context.profile(req);
        var rows=store.db.query("SELECT body::text FROM titles WHERE body->>'published'='true' AND body->>'deleted'='false' AND (body->>'maturity')::int<=? AND body->'regions' @> ?::jsonb AND (body->>'licenseStart')::timestamptz<=now() AND (body->>'licenseEnd')::timestamptz>now() AND strpos(lower(body->>'name'),lower(?))>0 ORDER BY id LIMIT ? OFFSET ?",(r,n)->store.decode(r.getString(1)),ctx.get("maturity"),store.encode(List.of(ctx.get("region"))),q,limit,offset);return Map.of("items",rows);
    }
    @GetMapping("/catalog/titles/{id}") Object detail(@PathVariable String id,HttpServletRequest req){var ctx=context.profile(req);var title=store.get(id);if(!context.eligible(title,ctx))throw new ResponseStatusException(HttpStatus.NOT_FOUND);return title;}
    @PostMapping("/internal/titles") Object batch(@RequestBody Map<String,List<String>> body,HttpServletRequest req){context.internal(req);var ctx=context.profile(req);var ids=body.get("ids");if(ids==null||ids.size()>100)throw new ResponseStatusException(HttpStatus.BAD_REQUEST);var items=new ArrayList<Map<String,Object>>();for(String id:ids){try{var t=store.get(id);if(context.eligible(t,ctx))items.add(t);}catch(ResponseStatusException e){if(e.getStatusCode().value()!=404)throw e;}}return Map.of("items",items);}
}

@Component
@ConditionalOnProperty(name="spring.application.name",havingValue="catalog-write")
class Relay {
    final Store store;final KafkaTemplate<String,String> kafka;Relay(Store store,KafkaTemplate<String,String> kafka){this.store=store;this.kafka=kafka;}
    @Scheduled(fixedDelay=500) public void flush() throws Exception {
        var rows=store.db.queryForList("SELECT id,aggregate_id,payload::text FROM outbox WHERE NOT sent ORDER BY created_at LIMIT 50");
        for(var row:rows){kafka.send("catalog.title.v1",row.get("aggregate_id").toString(),row.get("payload").toString()).get(5,TimeUnit.SECONDS);store.db.update("UPDATE outbox SET sent=true WHERE id=?",row.get("id"));}
    }
}

@Component
@ConditionalOnProperty(name="spring.application.name",havingValue="catalog-read")
class Projection {
    final Store store;Projection(Store store){this.store=store;}
    @KafkaListener(topics="catalog.title.v1",groupId="catalog-read-v1")
    @Transactional
    public void consume(String payload){var event=store.decode(payload);var title=event.get("data");var data=store.decode(store.encode(title));store.db.update("INSERT INTO titles(id,version,body) VALUES (?,?,?::jsonb) ON CONFLICT(id) DO UPDATE SET version=excluded.version,body=excluded.body,updated_at=now() WHERE titles.version<excluded.version",data.get("id"),event.get("version"),store.encode(title));}
}

@Configuration
class KafkaErrors {
    @Bean DefaultErrorHandler kafkaErrorHandler(){return new DefaultErrorHandler(new FixedBackOff(1000,FixedBackOff.UNLIMITED_ATTEMPTS));}
}

@RestControllerAdvice
class Errors {
    @ExceptionHandler({IllegalArgumentException.class,java.time.format.DateTimeParseException.class}) ResponseEntity<ProblemDetail> bad(Exception e){return ResponseEntity.badRequest().body(ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST,"Invalid title data"));}
    @ExceptionHandler(ResponseStatusException.class) ResponseEntity<ProblemDetail> status(ResponseStatusException e){return ResponseEntity.status(e.getStatusCode()).body(ProblemDetail.forStatusAndDetail(e.getStatusCode(),Objects.toString(e.getReason(),"Request rejected")));}
}
