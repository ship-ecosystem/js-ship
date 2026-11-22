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

## Portable releases

`ship release --tag TAG [--no-env]` writes the canonical `ship-release` manifest.
Project-built images are saved once, with their image ID, platform and archive
checksum. Registry images are pulled and pinned by digest in the exported Compose
file. The destination needs registry access for these images; the default release
is not a fully offline bundle. Mixed project-image platforms are rejected.

The release records HTTP entry points, service roles, volumes, external networks,
source revision, framework/runtime and console commands. Unknown application
health paths and public URL settings are `null`; Ship does not guess endpoints.
Deploy commands run after infrastructure with `run --rm --no-deps -T`; their argv
is identical in the manifest and executable script. Static images expose a shell
as UID 101 and do not advertise Node commands.

`.env.production` is validated locally. When present it is copied as `.env` with
mode 0600 unless `--no-env` is selected. Even then, the manifest records setting
names without values. Supply `.env` on the destination before starting services.
A missing settings file is allowed for applications with no required credentials.
Public build values are compiled into frontend assets and cannot be changed by
runtime `.env` settings. Build secrets are never included in the release.

Release directories are private (0700), deployment scripts executable (0755), and
existing tags are never replaced. Files are staged before publication;
`release.json` is written last as the completeness marker.

## Local conformance checks

`npm run check:spec -- PATH_TO_SPEC` compares both canonical schema files byte for
byte and checks the shared release checker for drift. `npm run check:release --
/path/to/dist/ship/TAG` validates a complete release folder, including cross-field
references, Compose service/image identities and archive hashes. Its checker is
adapted from the shared spec with only the schema path changed. These tools are
local development dependencies, not requirements on the deployment host.
