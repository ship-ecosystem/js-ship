# Ship ecosystem compatibility

The source of truth is [ship-ecosystem/spec](https://github.com/ship-ecosystem/spec).
`schema/canonical/` contains unmodified offline copies of its configuration and
release schemas. `schema/ship.schema.json` is a JavaScript editor profile with
stricter framework, service and runtime validation; it does not claim the
canonical schema's identity. Run `node scripts/check-spec.mjs PATH_TO_SPEC` locally
to check drift. JavaScript-specific properties are registered in the shared spec.
Changes to the local spec repository must be published separately before remote
editors or other ecosystem packages can consume them.

Processes accept commands or `{ command, healthcheck?, http? }` definitions. HTTP
metadata describes a real container port, role, optional healthy path and public
URL setting **name**, never a credential or URL value. External networks accept a
single name or a nonempty list. They must already exist on the deployment host.
Production processes share the app image; they do not automatically run in dev.

Existing production Compose project names retain their `-production` suffix.
This is a persistent-data identity: changing it changes Docker volume prefixes.
Do not rename deployed projects without an explicit data migration.
