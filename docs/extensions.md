# Extension API v1

Ship supports project-scoped framework adapters and infrastructure services through
compiled JavaScript modules. The public `ShipExtension`, `FrameworkAdapter`,
`ServiceDefinition` and `ExtensionRegistry` types are exported by `js-ship`.
Breaking changes to this planning contract require a new extension API version.

## Loading an extension

List the modules explicitly in the repository-root `ship.json`:

```json
{
  "extensions": ["ship.extensions.mjs"],
  "framework": "example-node",
  "services": { "cache": "example-cache" }
}
```

Each entry is a relative `.mjs`, `.cjs` or `.js` file. `./` prefixes are accepted.
Absolute paths, URLs, traversal and entry-file symlinks outside the project root
are rejected. There is no automatic discovery, package installation or TypeScript
execution. A module default-exports one extension object or an array of extension
objects; CommonJS modules use `module.exports`.

For example, `ship.extensions.mjs` can reuse supported public helpers:

```js
import { builtinAdapters, builtinServices } from 'js-ship';

export default {
  apiVersion: 1,
  name: 'example',
  version: '1.0.0',
  adapters: [{
    ...builtinAdapters.get('generic'),
    key: 'example-node',
    label: 'Example Node',
    defaultDeployment: 'node',
  }],
  services: [{
    ...builtinServices.get('redis'),
    key: 'example-cache',
    label: 'Example Redis cache',
  }],
  templates: {
    'notes.txt': 'Owned by the example extension.\n',
  },
};
```

Run `ship init` (or `ship init --framework example-node`) and `ship config:test`.
For existing templates, review edits and use `ship init --force`. Current templates
use format 9. The example's notes appear at `ship/extensions/example/notes.txt`.
Use `serviceNames` to rename existing services; an extension is not necessary for
renaming. Reusing complex built-in adapters/services may depend on their dedicated
core template strategy; the simple generic/Redis example above fits API v1.

If an entry module imports `js-ship`, install Ship locally where Node can resolve
it; a global CLI installation alone does not provide project imports. For checkout
testing, install the built tarball. Package extensions use a local bridge module:

```js
import provider from '@your-team/ship-extension';
export default provider;
```

The imported package can also expose a factory returning a `ShipExtension`, allowing
configuration in the bridge module. Dependencies must already be resolvable on the
host through normal Node module resolution. Bare package specifiers are not entries
in the `extensions` list. Extensions do not add arbitrary top-level `ship.json`
properties; use their own module/factory configuration.

## Registration and isolation

Every definition declares numeric `apiVersion: 1`, a unique lowercase slug `name`
and a semantic `version`. Adapter/service keys are unique within their registries.
Built-in keys cannot be replaced. A registry exposes read-only maps and frozen
metadata, and loading one project does not register its keys in another project.
Do not modify the built-in collections; use `createRegistry` or `loadExtensions`.

Callbacks are synchronous planning functions. Ship validates their results before
using them as commands, paths or environment values. Treat inputs as read-only and
keep results deterministic. Callback functions may use a class receiver, including
private fields, but shared mutable module state can still affect behavior.

## Framework adapter contract

An adapter defines:

- `key`, `label`, and optional `defaultDeployment` (`node` or `static`). Custom
  adapters are selected explicitly; built-in framework detection is unchanged.
- `defaults(manifest, deployment)`: all four fields `scripts`, `port`,
  `outputDirectory` and `staticRouting`.
- `validate(config, manifest)`: an array of project-validation error strings.
- `packaging(config)`: a validated `PackagingPlan`.
- `developmentCommand(config)` and `productionCommand(config)`: nonempty argument
  arrays, not shell strings. Use the exported `scriptCommand` helper for npm/pnpm/Yarn
  script forwarding and argument separators.
- Optional `buildArguments(config)`: extra build-script arguments. Custom adapters
  get no implicit Vite flags; return the arguments required by your build tool.

Node `project` runtimes retain the pruned app layout. Node `bundle` runtimes need
an output directory and an entrypoint within that directory; `runtimeDependencies`
controls copying pruned dependencies. Next-specific standalone layout is not an
extension runtime strategy. Workspace-isolated Node bundles remain unsupported.

Static runtimes require a safe output directory containing `index.html`, use port
8080 and the core unprivileged Nginx image. They cannot include Node workers,
deploy commands or runtimeFiles. Supply a compatible Nginx production command,
such as `['nginx', '-g', 'daemon off;']`. Core continues to own Docker stages,
package-manager installation/pruning, runtime floors and build-secret boundaries.

## Infrastructure service contract

A service defines `key`, `label`, `group`, `compose(context)` and
`appEnvironment(context)`. `databaseShell(context)` is optional for database
services. Groups may extend the built-in database/cache choices, for example a
`queue` or `search` group selected through `ship.json`.

The context supplies stable `resourceName`, final `serviceName`, `envPrefix`,
environment, config and project root. Its helpers are:

- `credential(name, developmentFallback)`: an environment expression that requires
  the value in production. It checks presence, not credential strength.
- `setting(name, fallback)`: an optional environment setting with the instance prefix.
- `volume(suffix)`: the stable volume name for that instance.

Declare owned named-volume suffixes in `volumes: ['data', 'config']`, and reference
them with `context.volume('data')`. Undeclared named mounts fail before file
publication. Bind mounts should use Compose's long syntax. Renaming a Compose
service preserves these resource/volume identities. No implicit volume is created
for an extension service that declares none.

`compose` returns a JSON-serializable Compose fragment with a literal image or a
build definition. Core supplies network attachment and build-owned image tags.
A service with a healthcheck is awaited as healthy; otherwise the app waits for
it to start. Custom services and their images need their own maintenance policy.
Node apps receive the service's environment map; static production apps do not.

Build-owned services share an image across named instances. Their build definitions
must be identical; use separate keys for distinct builds. For example:

```js
compose: context => ({
  build: {
    context: context.projectRoot,
    dockerfile: 'ship/extensions/example/Dockerfile',
  },
  volumes: [context.volume('data') + ':/data'],
  // Add the appropriate command and healthcheck for the chosen image.
})
```

Provide the Dockerfile and supporting text through the extension's `templates`
map. Paths are relative to `ship/extensions/<extension-name>/`; traversal and
non-text contents are rejected. Shell files receive executable permissions. Use
[build/runtime credential mechanisms](build-environment.md), not literal secrets
in template contents.

## Schemas, updates and releases

`ship init` writes a project-specific editor schema containing the registered
adapter/service choices. The bundled `shipConfigSchema` covers built-ins;
`createConfigSchema(registry)` produces the extended form for programmatic tools.
The CLI remains authoritative for filesystem and cross-field checks.

Template fingerprints record extension identities, local entry-source hashes,
namespaced files, registration metadata and packaging/build arguments. Bump the
extension version when changing an imported provider or its transitive helpers.
Changes to dependency code are not a complete transitive content hash.

Node caches imported modules. If an entry changes after import in an embedding
process, start a new process; the loader rejects reloading changed entry files.
Normal CLI invocations already run in new processes. Review custom edits and run
`ship init --force` when the template fingerprint changes. Removing an extension
does not automatically delete old files or stored volumes.

Release metadata records extension names, versions and a fingerprint. Generated
release Compose files and saved images deploy without importing the host extension
or installing the SDK. Extension source may remain in project-layout application
images like other source files; core does not execute it during deployment.

## Programmatic use

```js
import { readConfig, loadExtensions, buildProjectCompose } from 'js-ship';
const config = await readConfig(projectRoot);
const registry = await loadExtensions(projectRoot, config.extensions);
const model = await buildProjectCompose(config, projectRoot, 'production', 'v1', registry);
```

`createRegistry([provider])` supports embedding without file loading. Pass that
registry explicitly to planning operations; there is no global registration step.
The low-level synchronous `buildCompose` accepts it as the sixth argument (after
resolved workspace paths). Prefer the asynchronous helper for CLI-like usage.

## Host-code trust boundary

Extensions execute with the host process's filesystem, environment and network
access, including during `init` and `config:test`. Entry-path containment is not
a sandbox; transitive imports follow Node rules. Load only trusted extensions and
review project configuration before running project commands. `--help` and
`--version` do not load project extensions. API v1 supplies planning/data hooks,
not lifecycle hooks for host command execution.

## Optional ecosystem capabilities

API v1 remains compatible. Services can declare `developmentOnly: true` (omitted
from production), `onDemand: true` (the `ship-testing` Compose profile), and
`http(context)` returning `{ port, role, health?, urlSetting? }` entries for that
service. HTTP services join every configured external network and are described
in release metadata. Keep `resourceName`/`context.volume()` identities independent
of `serviceName`; use context configuration to resolve other selected providers.

Framework adapters can implement:

- `suggestProcesses(config, manifest)`: a name-to-`{ label, definition }` map. The
  definition is a command or `{ command, healthcheck?, http? }`. The wizard offers
  these without installing libraries or inventing handlers. Without the hook,
  Ship suggests recognizable existing worker/realtime package scripts.
- `describeRelease(config, projectRoot)`: `{ health?, urlSetting?, requiredEnv?,
  console? }`. Read actual project configuration when appropriate. `health` is a
  known 2xx path or null; `urlSetting` is a variable name, never its value;
  `requiredEnv` names are validated against production settings. `console` maps
  command names to argv prefixes available in the production image.

These synchronous hooks execute trusted project extension code. Hook results are
validated. Do not advertise commands that traced/isolated images do not contain,
or required runtime secrets for static frontend assets. The release writer and
wizard consume these capabilities through the same registry as Compose planning.
