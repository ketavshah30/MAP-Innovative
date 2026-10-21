package local.streaming.catalog;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.security.oauth2.core.*;

@Configuration
public class Security {
    @Bean JwtDecoder decoder() {
        var decoder = NimbusJwtDecoder.withJwkSetUri(System.getenv("JWT_JWKS_URL")).build();
        OAuth2TokenValidator<Jwt> audience = jwt -> jwt.getAudience().contains("streaming") ? OAuth2TokenValidatorResult.success() : OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token"));
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(JwtValidators.createDefaultWithIssuer(System.getenv("JWT_ISSUER")), audience));
        return decoder;
    }
    @Bean SecurityFilterChain chain(HttpSecurity http) throws Exception {
        return http.csrf(c -> c.disable()).authorizeHttpRequests(a -> a.requestMatchers("/health/**", "/actuator/health/**").permitAll().anyRequest().authenticated()).oauth2ResourceServer(o -> o.jwt(j -> {})).build();
    }
}
