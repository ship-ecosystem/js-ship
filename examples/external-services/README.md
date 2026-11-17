# External service connections

A minimal Node app with an optional connection-check command for PostgreSQL,
Redis and MongoDB. The clients are dependencies of this example, not runtime
dependencies of `js-ship`. Run it from a source checkout or copy this directory
into a separate application directory; repository examples are not in the npm SDK
tarball.

The supplied ship.json selects no managed infrastructure. It also configures an
explicit release preflight that runs `npm run check:connections` when you invoke
the exported `deploy-commands.sh`. The normal HTTP server serves the generic Ship
example response; it does not query any database.

```sh
cp .env.example .env
# Edit .env: uncomment the URLs you need and replace every placeholder.
ship init --no-interaction
ship up
ship npm run check:connections
```

The committed lockfile pins `pg` 8.23.1, `redis` 6.3.1 and `mongodb` 7.9.0. You do
not need to install them on the host: Ship installs them inside the app container.
The probe skips unset URLs, exits 1 when none are set or any selected connection
fails, and prints fixed status messages without URLs or driver error objects.
It uses `SELECT 1` for PostgreSQL and `PING` for Redis/MongoDB; it does not test
schema permissions, migrations, failover or continuous connection recovery.
Its timeouts/retry settings are diagnostic defaults, not a production access layer.

Use provider-issued TLS connection settings and application-level credentials.
The client libraries interpret the URLs; Ship does not translate them. MongoDB SRV
and cluster settings remain intact when `MONGODB_HOST` and named
`*_MONGODB_HOST` variables are absent. A blank host key is still a host key;
remove it rather than leaving it empty. See [external databases](https://github.com/ship-ecosystem/js-ship/blob/main/docs/external-services.md)
and [environment boundaries](https://github.com/ship-ecosystem/js-ship/blob/main/docs/environment.md).

Create a separate `.env.production` with the production connection URLs and
application values. It is required for a portable release, even if there are no
managed databases:

```sh
ship config:test
ship release --tag external-test
```

The private release appears under `dist/ship/external-test`. Copy it to a host
that can reach the providers. From that copied directory, load the archives listed
in its README, run `sh deploy-commands.sh` to execute the explicit connection
preflight, then run `docker compose up -d`. The app image and private `.env` are
sufficient; the SDK and original sources are not required. The release contains
credentials and must remain private. Provider data and provider services are not
exported or provisioned by this release.

`ship up`, `config:test` and `doctor` do not establish external database readiness.
Use the probe from the actual destination network before serving traffic, then
implement application-specific retries, pooling and failure handling. An optional
`externalNetwork` in ship.json can join an existing Docker network for private
services on the same Docker daemon; internet-hosted services normally use the
app's outbound DNS/network connection instead.

Verification uses separate authenticated PostgreSQL/Redis/MongoDB Docker containers
on a shared network, without TLS. It covers development, production, a worker,
release preflight, credential failure/redaction and app-image credential exclusion.
Hosted providers, Atlas SRV discovery, TLS handshakes, provider firewalls and
cross-host network access have not been exercised by that fixture.
