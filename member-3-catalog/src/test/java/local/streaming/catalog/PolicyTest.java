package local.streaming.catalog;
import org.junit.jupiter.api.Test;
import java.time.Instant;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class PolicyTest {
    Map<String,Object> title(){return new HashMap<>(Map.of("published",true,"deleted",false,"maturity",12,"regions",List.of("IN"),"licenseStart","2026-01-01T00:00:00Z","licenseEnd","2027-01-01T00:00:00Z"));}
    @Test void licenseBoundsAreHalfOpen(){var t=title();assertTrue(Policy.eligible(t,"IN",12,Instant.parse("2026-01-01T00:00:00Z")));assertFalse(Policy.eligible(t,"IN",12,Instant.parse("2027-01-01T00:00:00Z")));}
    @Test void regionMaturityAndPublicationAreMandatory(){var t=title();var now=Instant.parse("2026-06-01T00:00:00Z");assertFalse(Policy.eligible(t,"US",18,now));assertFalse(Policy.eligible(t,"IN",7,now));t.put("published",false);assertFalse(Policy.eligible(t,"IN",18,now));}
}
