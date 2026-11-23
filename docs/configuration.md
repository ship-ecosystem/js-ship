# Configuration and editor support

`ship init` creates `ship.json` with a local JSON Schema reference:

```json
{
  "$schema": "./ship/ship.schema.json",
  "framework": "generic",
  "deployment": "node",
  "node": "24",
  "packageManager": "npm",
  "packageManagerVersion": "12.2.2"
}
```

The generated `ship/ship.schema.json` is self-contained and can be committed with
`ship.json`. Editors that support JSON Schema can offer completion, documentation
and validation without a public GitHub repository or npm release. Ship never
fetches the URL/path in `$schema`; it is an editor hint, not executable configuration.

The schema covers all configuration properties, the fifteen built-in adapter keys,
service groups and choices, command forms, safe relative paths, public build values
and named secret restrictions. Objects reject unknown properties. `null` is allowed
only where explicitly supported, such as `workspace`, `serverEntry`, `outputDirectory`,
`angularProject`, `externalNetwork`, and `scripts.build`/`scripts.start`. Omit other
optional fields to select defaults. Editor default annotations are suggestions;
`ship init` and the CLI apply the actual project-dependent defaults.

On each `ship init`, Ship refreshes its generated schema copy. Treat this file as
a package-owned artifact; put team customizations in a separate schema. An explicit
`$schema` reference in an existing configuration is preserved. Existing projects
can run `ship init` to add the local reference; older Docker template versions may
also require reviewing custom edits and running `ship init --force`.

Extension projects receive a generated schema with their registered choices; see
[Extension API v1](extensions.md).

## Project-aware checks

Editor validation checks the document, not the project filesystem. Always run:

```sh
ship config:test
```

The CLI additionally checks framework deployment compatibility, package scripts,
lockfile/version agreement, generated templates, service-name collisions, unique
named instances, public/secret variable overlap and required credential files.
An editor-valid document can still fail these checks. Node/package-manager choices
must also be compatible with the particular application and framework version.

See [framework deployment modes](frameworks.md), [build environment](build-environment.md),
[workspaces](workspaces.md), [extensions](extensions.md), and [MongoDB](mongodb.md) for the corresponding configuration options and boundaries.

Applications connecting to hosted or independently managed databases can follow
[external services](external-services.md) and [environment boundaries](environment.md).

## Tooling integration

The npm tarball includes the shared configuration schema and exports it as
`js-ship/schema.json`. Use `shipConfigSchema` for the JavaScript editor profile.
Node tooling can resolve its installed file without a network request:

```js
import { createRequire } from 'node:module';
const schemaPath = createRequire(import.meta.url).resolve('js-ship/schema.json');
```

ESM tools can also import the object:

```js
import { shipConfigSchema } from 'js-ship';
```

No schema validator is installed as a runtime dependency. A tool that wants to
validate input independently can supply its own JSON Schema validator. The schema
uses [JSON Schema draft-07](https://json-schema.org/draft-07), including variable-length
command tuples (a nonempty executable followed by string arguments). For AJV strict
mode, use `strictTuples: false` to allow that intentional tuple shape. The package's
schema tests use AJV only as a development dependency.

`src/schema.ts` and the runtime parser share syntax rules from `src/config-rules.ts`.
`npm run build` generates `schema/ship.schema.json`; keep the generated file committed.
Tests compile the schema, validate generated configurations and malformed inputs,
and verify that a separately installed tarball exports and copies the same schema.

## Ecosystem schemas and additional capabilities

The canonical ecosystem schema is bundled unmodified under `schema/canonical/`.
The local editor profile is stricter and intentionally has a separate identity.
`ship init` omits an absent external network from serialized JSON; the runtime
parser also accepts legacy `null`. A configured network may be one name or a
nonempty unique list. HTTP processes support `{ command, healthcheck?, http? }`
with literal container port, role, healthy path and public URL setting name.
`hostUser` defaults true; `siloImage` selects standard/distroless.

See [ecosystem compatibility](ecosystem-parity.md) for canonical drift checks and
[services](services.md) for all built-in groups. These shared-schema additions are
committed locally in the spec repository and require separate publication before
the remote canonical URL describes them.
