# MongoDB

MongoDB is a built-in database service. Both standalone and single-member
replica-set modes have passed live Docker checks; see the verification scope below.

```sh
ship init --database mongodb --mongodb-mode replica-set
ship up
ship db
```

```json
{
  "services": { "database": "mongodb" },
  "mongodbMode": "replica-set",
  "additionalServices": [
    { "group": "database", "service": "mongodb", "name": "analytics" }
  ]
}
```

## Topology and credentials

`replica-set` is the default and creates a single-member `rs0` for transaction and
change-stream compatibility. It provides no redundancy. `standalone` is explicit
and does not provide these replica-set features. This is not a managed, multi-node
production cluster. External MongoDB/Atlas connections can be supplied through
your runtime `MONGODB_URI` without selecting a local MongoDB service. Omit
`MONGODB_HOST` and matching named host keys to retain the provider URI; see
[external services](external-services.md).

MongoDB runs from a project-owned image based on `mongo:8.0`. Ship publishes
`ship/mongodb/` bootstrap/health files. Named instances share this image; each
has separate data and configuration/key volumes. Release builds/exports the image
once and boots it on the destination without access to these source files.

The database creates an administrator in `admin` and a separate application user
with `readWrite` on its application database. Defaults:

| Variable | Development default |
| --- | --- |
| `MONGODB_DATABASE` | `ship` |
| `MONGODB_USER` | `ship` |
| `MONGODB_PASSWORD` | `shipsecret` |
| `MONGODB_ROOT_USER` | `shipadmin` |
| `MONGODB_ROOT_PASSWORD` | `shiprootsecret` |

Production requires unique `MONGODB_PASSWORD` and `MONGODB_ROOT_PASSWORD` in
`.env.production` and rejects the development defaults. Named instances prefix
all variables: `ANALYTICS_MONGODB_PASSWORD`, `ANALYTICS_MONGODB_ROOT_PASSWORD`, etc.
Use an application database name; `admin`, `local` and `config` are rejected.

Initialization happens only on a fresh data volume. Editing environment values
does not rotate existing users/passwords or recreate the database. Rotate
credentials through authenticated MongoDB administration and update your env
values together; never delete production volumes to change credentials.

## Connection environment

Node app containers receive `MONGODB_HOST`, `MONGODB_PORT`, `MONGODB_DATABASE`,
`MONGODB_USER`, `MONGODB_PASSWORD`, and `MONGODB_REPLICA_SET` (empty in standalone
mode). The app entrypoint constructs `MONGODB_URI` at runtime with percent-encoded
credentials, the database authSource, and directConnection for this one-member
topology. Named instances receive `ANALYTICS_MONGODB_URI`, etc.

The root-password source variable is explicitly blanked in the app's Compose
environment so `.env.production` cannot inject it through env_file, and removed
from the application child environment. Workers and deploy commands use the same
entrypoint. `ship exec app`, `ship shell` and package-manager proxies also run
through it; raw `docker exec` bypasses this computed environment.

Ship does not install the MongoDB driver or Mongoose. Static frontend containers
receive none of these infrastructure variables; use a backend to access MongoDB.
No database host port is published. `ship db [instance]` runs `mongosh` inside the
database using its application credentials.

## Startup and persistent resources

The official image first initializes root/app users on its temporary standalone
server. Ship waits for the final authenticated server before replica-set
initialization. A key is generated once and retained in the configuration volume;
the key is never baked into an image. The healthcheck requires final authentication,
working app credentials, and an elected writable primary in replica-set mode.

`serviceNames` changes hostnames, not data/key volume identities. Stop the current
stack with `ship down` before changing service names. On restart the bootstrap
can update the advertised host for its known, single-member `rs0`. It refuses to
reconfigure a multi-member or unrelated set. Upgrading to a managed/multi-node
topology requires an explicit migration outside this bootstrap.

For startup failures, crashes or mismatched persisted credentials, see
[startup, shutdown and recovery](recovery.md).

## Verification

```sh
npm run test:docker
```

The MongoDB live test covers special-character credential encoding, app/admin
privilege separation, real transactions and change streams, persistence through a
service rename, image deduplication, and a source-free release with a second
MongoDB instance. A separate standalone case verifies authentication, writes,
connection URI and persistence through down/up. The recovery case adds unhealthy
startup, an unexpected mongod exit, manual stop/start and a mismatched persisted
root credential. It checks retained records, a post-restart transaction, volume/key
identity and quiet health diagnostics. See [verification notes](verification.md)
for results, the environment and remaining checks.

- [Official image initialization](https://hub.docker.com/_/mongo)
- [Replica-set deployment](https://www.mongodb.com/docs/manual/tutorial/deploy-replica-set/)
- [Replication and change streams](https://www.mongodb.com/docs/manual/replication/)
