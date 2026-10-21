package local.streaming.catalog;

import java.time.Instant;
import java.util.*;

public final class Policy {
    private Policy() {}
    public static Map<String,Object> validate(Map<String,Object> input) {
        Set<String> fields=Set.of("name","genres","maturity","regions","licenseStart","licenseEnd","assetPath","durationSeconds","maxQuality");
        if(!fields.containsAll(input.keySet()) || !input.keySet().containsAll(fields)) throw new IllegalArgumentException("All title fields required; unknown fields rejected");
        if(!(input.get("name") instanceof String name) || name.isBlank() || name.length()>200) throw new IllegalArgumentException("Invalid name");
        int maturity=integer(input.get("maturity"));
        if(maturity<0||maturity>18||integer(input.get("durationSeconds"))<1||integer(input.get("durationSeconds"))>86400) throw new IllegalArgumentException("Invalid maturity or duration");
        if(!(input.get("genres") instanceof List<?> genres)||genres.size()>20||genres.stream().anyMatch(x->!(x instanceof String s)||s.isBlank()))throw new IllegalArgumentException("Invalid genres");
        if(!(input.get("regions") instanceof List<?> regions)||regions.isEmpty()||regions.stream().anyMatch(x->!(x instanceof String s)||!s.matches("[A-Z]{2}")))throw new IllegalArgumentException("Invalid regions");
        Instant start=Instant.parse((String)input.get("licenseStart")),end=Instant.parse((String)input.get("licenseEnd"));
        if(!end.isAfter(start))throw new IllegalArgumentException("Empty license window");
        String asset=(String)input.get("assetPath");
        if(!asset.matches("[A-Za-z0-9_-]+/master\\.m3u8"))throw new IllegalArgumentException("Asset must be <asset>/master.m3u8");
        if(!Set.of("SD","HD","UHD").contains(input.get("maxQuality")))throw new IllegalArgumentException("Invalid quality");
        return new LinkedHashMap<>(input);
    }
    private static int integer(Object value) {
        if(!(value instanceof Number n)||n.doubleValue()!=n.intValue())throw new IllegalArgumentException("Expected integer");return n.intValue();
    }
    @SuppressWarnings("unchecked")
    public static boolean eligible(Map<String,Object> title,String region,int maturity,Instant now) {
        return Boolean.TRUE.equals(title.get("published"))&&!Boolean.TRUE.equals(title.get("deleted"))&&integer(title.get("maturity"))<=maturity&&((List<String>)title.get("regions")).contains(region)&&!now.isBefore(Instant.parse((String)title.get("licenseStart")))&&now.isBefore(Instant.parse((String)title.get("licenseEnd")));
    }
}
