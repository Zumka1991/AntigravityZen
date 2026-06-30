FROM golang:1.25-alpine AS builder
WORKDIR /app
RUN apk add --no-cache gcc musl-dev
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=1 GOOS=linux go build -trimpath -ldflags="-s -w" -o server main.go

FROM alpine:3.22
RUN apk add --no-cache ca-certificates tzdata \
    && addgroup -S app \
    && adduser -S -G app -h /data app \
    && mkdir -p /data/uploads/recordings \
    && chown -R app:app /data
COPY --from=builder /app/server /usr/local/bin/server
WORKDIR /data
USER app
EXPOSE 8080
CMD ["server"]
