# Services

Ship configures containers and connection settings. Install the corresponding
JavaScript client or framework integration in your application; Ship never adds
SDK dependencies or application handlers automatically.

| Group | Built-in choices |
| --- | --- |
| database | postgres, mysql, mariadb, mongodb, sqlserver |
| cache | redis, valkey, memcached |
| storage | seaweedfs, garage, rustfs, silo |
| search | meilisearch, elasticsearch, typesense |
| mail | mailpit |
| broker | rabbitmq |
| broadcasting | centrifugo |
| testing | playwright, cypress, selenium |
| queue-dashboard | bull-board |

Use one primary provider per group and `additionalServices` for named instances:

```json
{
  "services": { "database": "postgres", "cache": "redis", "storage": "garage" },
  "additionalServices": [{ "group": "database", "service": "mysql", "name": "analytics" }],
  "serviceNames": { "mysql-analytics": "analytics-db" }
}
```

Named instances use an uppercase environment prefix (`ANALYTICS_`) and stable
persistent resource names. Renaming the Compose service changes connection hosts,
not its volume. Databases and stateful infrastructure persist in both environments.
`ship db analytics` opens the named database client. Infrastructure ports are not
publicly exposed by default in production; HTTP services join external networks.

The portable database settings follow the shared spec. PostgreSQL uses
`DB_DATABASE`, `DB_USERNAME` and `DB_PASSWORD`. Existing `DB_NAME` and `DB_USER`
settings remain aliases. MongoDB uses `MONGODB_USERNAME` and accepts the previous
`MONGODB_USER` alias. MySQL, MariaDB and SQL Server use the same `DB_*` settings and a separate
`DB_ROOT_PASSWORD`; the root credential is not injected into the app. Client
configuration is application-owned. Never construct a database URL by concatenating
unescaped credentials; use your client's structured connection options.

Redis/Valkey are private to the Ship network. Do not publish unauthenticated cache
ports. BullMQ jobs require persistent Redis and a suitable memory/eviction policy
for your workload. Memcached is an ephemeral cache and is unsuitable for queues.

Storage uses S3-style `AWS_*` settings. Silo and RustFS require creating the bucket
before first use; Garage provisions its configured default bucket. Silo supports
`"siloImage": "distroless"` for machines that cannot use the standard x86-64-v2
image. Garage has a project-built image and is archived in releases; each named
instance gets its own RPC address. Back up data and metadata together.

SQL Server uses an amd64 image (ARM requires emulation), accepts Microsoft's EULA,
and defaults to the Developer edition. Production use needs an appropriate license
and `MSSQL_PID`; password policy must be satisfied. Elasticsearch also requires
appropriate host kernel/resource settings. These operational requirements are not
removed by containerization.

## Browser testing

Mailpit is development-only and never captures production email. Its default web UI
is available on loopback at `MAILPIT_WEB_PORT` (8025 by default). Named Mailpit
instances require an explicit override to publish their UI.

Browser tools run only in development and never enter production releases.

- Playwright runs a browser server with `PW_TEST_CONNECT_WS_ENDPOINT`; configure
  `use.baseURL` from `PLAYWRIGHT_BASE_URL`. Match the project's Playwright version
  to the server image (currently 1.65.1). The browser container downloads that exact
  server package on its first start.
- Cypress is an on-demand container under the `ship-testing` Compose profile.
  Start the app with `ship up`, then use `ship test` (or `ship test -- --spec ...`).
  Its `CYPRESS_BASE_URL` follows app renames and ports. A dedicated runner dependency
  volume masks host node_modules, and the image's Cypress package is made available
  for the standard `defineConfig` import. Custom Cypress config plugins
  must have their dependencies available in the runner, not only in app's isolated
  node_modules volume; use an override to install runner dependencies if needed.
- Selenium supplies the WebDriver endpoint in `SELENIUM_REMOTE_URL`. Connect
  `selenium-webdriver` or WebdriverIO from the app; configure the test target from
  `WEBDRIVER_BASE_URL`. WebdriverIO is a test runner, not another browser server.

## Queues and real-time applications

Bull Board is a standalone dashboard, using the official
[Docker image](https://felixmosh.github.io/bull-board/guide/docker). Select Redis or
Valkey first. Production requires `BULL_BOARD_PASSWORD` and defaults to read-only operations.
Set `BULL_BOARD_READ_ONLY=false` explicitly when write operations are intended;
`BULL_BOARD_PREFIX` and `BULL_BOARD_BASE_PATH` configure queue discovery and routing.
Put the dashboard behind
an authenticated reverse proxy and do not expose it publicly without access control.

BullMQ workers and Socket.IO/ws servers run application code. Configure them as
`processes`, sharing the app image. Prefer existing package scripts so Ship does not
guess a handler filename. HTTP processes declare their container port, healthy path
when known, and the public URL setting name. Centrifugo is the independent server
alternative and requires no project-owned server implementation.

No Octane, Reverb or Dusk services are included: those integrations are PHP-specific.

Centrifugo's development browser URL uses the selected framework's public prefix:
`NEXT_PUBLIC_`, `NUXT_PUBLIC_`, `GATSBY_`, `PUBLIC_` (Astro/SvelteKit) or `VITE_`.
For production, explicitly configure the final public URL in `build.publicEnv`
using that framework's build mechanism. Runtime secrets remain server-side.

### Upgrading existing PostgreSQL and Redis volumes

The PostgreSQL default is 18.7 and mounts the named volume at
`/var/lib/postgresql`. For a project with a PostgreSQL 17 volume, use the
previous Ship version to take a logical backup, then restore and verify it in a
fresh PostgreSQL 18 volume before switching the project over. Keep the original
volume until the migration is verified. PostgreSQL 18 refuses to initialize
over a PostgreSQL 17 database.

The Redis default is 8.10.3. Back up existing persistent Redis data before
upgrading from Redis 7 and verify the application against Redis 8 before
switching over.

Ship builds PostgreSQL, MySQL, Typesense, SeaweedFS and Cypress from their pinned upstream
versions and applies distribution package updates. The rebuilt production service
images ship in portable releases.
