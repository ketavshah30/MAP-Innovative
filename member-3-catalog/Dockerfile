FROM maven:3.9.9-eclipse-temurin-21 AS build
WORKDIR /build
COPY pom.xml .
COPY src ./src
RUN mvn -B verify
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY --from=build /build/target/catalog-0.1.0.jar app.jar
USER 10001:10001
ENTRYPOINT ["java","-jar","app.jar"]
