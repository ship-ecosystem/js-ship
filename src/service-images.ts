// Generated from images/services/Dockerfile; review provider image changes before release.
export const SERVICE_IMAGES = {
  "mysql": "mysql:9.7",
  "mariadb": "mariadb:13.0",
  "sqlserver": "mcr.microsoft.com/mssql/server:2025-CU11-ubuntu-24.04",
  "valkey": "valkey/valkey:9.0-alpine",
  "memcached": "memcached:1.6-alpine",
  "seaweedfs": "chrislusf/seaweedfs:4.46",
  "rustfs": "rustfs/rustfs:1.0.0",
  "silo": "pgsty/silo:RELEASE.2026-09-16T00-00-00Z",
  "meilisearch": "getmeili/meilisearch:v1.53",
  "elasticsearch": "elasticsearch:9.5.5",
  "typesense": "typesense/typesense:30.2",
  "mailpit": "axllent/mailpit:v1.31",
  "playwright": "mcr.microsoft.com/playwright:v1.65.1-noble",
  "cypress": "cypress/included:16.3.0",
  "centrifugo": "centrifugo/centrifugo:v6.10",
  "rabbitmq": "rabbitmq:4.4-management-alpine",
  "selenium": "selenium/standalone-chromium:4.53.0-20261120",
  "bullboard": "ghcr.io/felixmosh/bull-board:9.14.0",
  "garage": "dxflrs/garage:v2.4.1",
  "garageconfig": "alpine:3.24.2",
  "silodistroless": "pgsty/silo:RELEASE.2026-09-16T00-00-00Z-distroless"
} as const;
