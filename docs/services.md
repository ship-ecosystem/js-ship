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

The portable server definitions and probes follow PHP Ship. PostgreSQL and MongoDB
retain js-ship's existing `DB_NAME`/`DB_USER` and `MONGODB_*` settings. MySQL, MariaDB
and SQL Server use `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD` and a separate
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

Browser tools run only in development and never enter production releases.

- Playwright runs a browser server with `PW_TEST_CONNECT_WS_ENDPOINT`; configure
  `use.baseURL` from `PLAYWRIGHT_BASE_URL`. Match the project's Playwright version
  to the server image (currently 1.65.1). The browser container downloads that exact
  server package on its first start.
- Cypress is an on-demand container under the `ship-testing` Compose profile.
  Start the app with `ship up`, then use `ship test` (or `ship test -- --spec ...`).
  Its `CYPRESS_BASE_URL` follows app renames and ports. Custom Cypress config plugins
  must have their dependencies available in the runner, not only in app's isolated
  node_modules volume; use an override to install runner dependencies if needed.
- Selenium supplies the WebDriver endpoint in `SELENIUM_REMOTE_URL`. Connect
  `selenium-webdriver` or WebdriverIO from the app; configure the test target from
  `WEBDRIVER_BASE_URL`. WebdriverIO is a test runner, not another browser server.

## Queues and real-time applications

Bull Board is a standalone dashboard, using the official
[Docker image](https://felixmosh.github.io/bull-board/guide/docker). Select Redis or
Valkey first. Production requires `BULL_BOARD_PASSWORD`; put the dashboard behind
an authenticated reverse proxy and do not expose it publicly without access control.

BullMQ workers and Socket.IO/ws servers run application code. Configure them as
`processes`, sharing the app image. Prefer existing package scripts so Ship does not
guess a handler filename. HTTP processes declare their container port, healthy path
when known, and the public URL setting name. Centrifugo is the independent server
alternative and requires no project-owned server implementation.

No Octane, Reverb or Dusk services are included: those integrations are PHP-specific.
