# External PostgreSQL, Redis and MongoDB

Ship can run your application against providers it does not manage. Connection
configuration and client libraries belong to the application. Ship does not
provision external databases, install their drivers into your app or validate
provider credentials.

## Select application-owned connections

For an existing development stack, run `ship down` with its current configuration
before changing the topology. Named volumes are retained; arrange any database
migration separately. For a new project, or after stopping the old stack, select
application-owned connections:

```sh
ship init --no-interaction --database none --cache none
```

The resulting primary selection is `"services": {}`. Review `additionalServices`
separately: `none` does not remove named instances. Preserve existing volumes
when you need their data. Switching to an external provider does not migrate or
copy that data.

For a fresh external-only project, these fields are sufficient alongside normal
framework/package-manager configuration:

```json
{
  "services": {},
  "additionalServices": []
}
```

Put the connection names your app reads in `.env` for development and
`.env.production` for production. The Node example uses these conventions:

```dotenv
DATABASE_URL='postgresql://app:URL_ENCODED_PASSWORD@postgres.example.invalid:5432/app?sslmode=verify-full'
REDIS_URL='rediss://app:URL_ENCODED_PASSWORD@redis.example.invalid:6379'
MONGODB_URI='mongodb+srv://app:URL_ENCODED_PASSWORD@cluster.example.invalid/app?retryWrites=true&w=majority'
```

These are templates with deliberately non-resolving hosts. Replace the complete
URL with your provider's application connection string. Use application-level
credentials and retain its TLS, authentication, topology and discovery options.
Percent-encode username/password components when constructing URLs; preserve an
already encoded provider string. Single quotes keep Compose from interpolating
literal dollar expressions in these values. See [environment boundaries](environment.md).

These variable names are choices made by the example app. Your ORM or client may
read different names. You must pass the selected values into that client. A
connection string in an environment file alone does not create a connection.

## Avoid managed-service overrides

A selected built-in service supplies its own connection fields in generated
Compose `environment`, which takes precedence over matching env-file values:

| Selected service | Managed application values |
| --- | --- |
| PostgreSQL | `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` |
| Redis | `REDIS_URL` |
| MongoDB | `MONGODB_HOST`, port/database/user/password fields and replica-set setting; entrypoint-derived `MONGODB_URI` |

Named instances use their configured prefix, such as `ANALYTICS_MONGODB_HOST`.
A managed primary can coexist with an unrelated external connection under an
application-owned variable name, but changing the same managed connection is not
a switch to an external provider.

For an external MongoDB URI, omit `MONGODB_HOST` and any matching named host key.
Ship's entrypoint constructs a local single-host URI whenever such a key exists,
including when it is empty. An empty value fails validation; a populated value
replaces the corresponding URI and adds `directConnection=true`. Use the complete
provider URI without those host keys to retain Atlas SRV discovery or multi-host
connection options. Built-in single-member replica-set settings are not a managed
cluster configuration.

## Drivers and TLS

Install the client in the application's production dependencies so it remains
available after dependency pruning. The
[repository example](https://github.com/ship-ecosystem/js-ship/tree/main/examples/external-services)
uses `pg`, `redis` and `mongodb`, with a committed npm lockfile. Equivalent ORM
configuration is application-specific.

- PostgreSQL: configure TLS and certificate validation in `pg`/your ORM using the
  provider's instructions. With `pg`, SSL URL parameters can replace an explicit
  `ssl` options object, so combine them deliberately. See [node-postgres TLS](https://node-postgres.com/features/ssl).
- Redis: use the provider's TLS settings (`rediss://` for a TLS URL) and its ACL
  username/password. Cluster and Sentinel deployments need the appropriate client
  mode; the example's single-endpoint probe does not configure those modes. See
  [Node Redis connections](https://redis.io/docs/latest/develop/clients/nodejs/connect/).
- MongoDB: preserve the provider's URI options. `mongodb+srv` enables TLS by
  default; leave certificate and hostname validation enabled. See
  [MongoDB TLS](https://www.mongodb.com/docs/drivers/node/current/security/tls/)
  and [connection options](https://www.mongodb.com/docs/drivers/node/current/connect/connection-options/).

For private certificate authorities or client certificates, provision the files
at the container paths expected by the driver and configure its trust settings.
A BuildKit secret mount exists only during its build step and is not a runtime
certificate mount. Development Compose overrides are not automatically exported
into release directories; arrange required certificate mounts on the destination.
Keep private keys outside the application image and private release contents
under deployment access controls.

## Network and lifecycle

Inside a container, `localhost` refers to that container. Use a provider's reachable
DNS name, not the host machine's loopback address. Configure DNS/SRV access,
firewall rules, TLS trust and provider access lists for the application's actual
egress network. Ship does not create VPNs, allowlist entries or network routes.

For another Docker project on the same daemon, set `externalNetwork` to an
existing network and use that provider's network alias. Ship attaches the app and
production workers to the network; the provider remains independently managed.
That external network must also exist on a release destination if the configuration
references it. Ordinary hosted endpoints do not require this option.

External providers are absent from the application's Compose services, dependency
health gates, data volumes and image exports. `ship down` leaves them alone.
`ship db` opens only a selected built-in database container; use your application's
client or the provider's tools for external administration. A portable release
contains the app image, connection environment and optional explicit deploy
commands, not provider data or a database backup.

Generated builds do not join the app's `externalNetwork`. A data-fetching build
needs a provider reachable from the builder and an explicitly granted build secret;
runtime env files and app service dependencies do not supply that access. Custom
build networking remains application-specific.

## Verify the actual connection

`ship config:test` validates Ship's project/configuration and selected built-in
credential requirements. `doctor` inspects project-owned development containers.
`ship up` waits for local selected services and an HTTP response. None of these
proves that an external URL is valid or that its database is reachable.

For the example, run `ship npm run check:connections` after startup. It reads the
configured URLs, executes read-only probes and reports a nonzero exit status on
failure. It deliberately omits URLs and driver error objects from output. It can
also be configured as an explicit release deploy command, run after loading images
and before starting the app. Implement suitable connection pooling, startup policy,
retries and request-level handling in the real application.

The live fixture checks authenticated PostgreSQL/Redis/MongoDB on a separate Docker
network/project, including source-free release and worker access. It does not
establish hosted-provider connectivity, TLS behavior, Atlas SRV discovery,
provider-side failover or cross-host routing. See [verification](verification.md).
