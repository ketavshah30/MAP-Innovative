FROM golang:1.23.6-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go test ./... && CGO_ENABLED=0 go build -trimpath -o /server ./cmd/server
FROM alpine:3.21
RUN apk add --no-cache ca-certificates
COPY --from=build /server /server
USER 10001:10001
ENTRYPOINT ["/server"]
