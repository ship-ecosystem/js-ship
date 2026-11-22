# Workspaces and monorepos

Keep Ship at the repository root, beside the root manifest and the single committed
lockfile. Select one application by directory:

```sh
ship init --workspace apps/api
ship up
```

Ship detects the framework and scripts from `apps/api/package.json`, while the
package-manager pin and lockfile belong to the repository root. Multiple apps can
exist in the workspace, but one Ship project selects one app. Run Ship from the root
or pass `--project-directory /path/to/repository`.

To build local libraries before the selected app, edit `ship.json`:

```json
{
  "workspace": {
    "app": "apps/api",
    "buildDependencies": ["packages/core", "packages/shared"]
  }
}
```

The listed packages run their `build` scripts in exactly that order, followed by
the selected application's configured build script. Ship does not infer a dependency
graph or run a task scheduler. Development startup installs dependencies at the root,
builds these libraries once, then starts the app's development script. Supply your
own watchers if shared libraries need continuous rebuilding.

After changing workspace/app/build-order settings, review generated-file edits and
run `ship init --force`. Current templates use format 9. Adding or removing workspace
package directories also needs a template refresh for dependency-volume setup.
Changing apps with `ship init --workspace apps/web --force` redetects framework
and script defaults; review the resulting `ship.json`.

## Supported workspace declarations

For npm, use the root `package.json`:

```json
{
  "private": true,
  "packageManager": "npm@12.2.2",
  "workspaces": ["apps/*", "packages/**", "!packages/examples/**"]
}
```

Yarn 4 also uses root manifest workspace declarations, with an exact
`yarn@VERSION` pin and root `.yarnrc.yml` selecting `nodeLinker: node-modules`.
See [Yarn setup and limits](yarn.md).

The `{ "packages": [...] }` form of the workspaces field is also accepted for npm.
For pnpm, use a root `pnpm-workspace.yaml` and pin pnpm in the root manifest:

```yaml
packages:
  - 'apps/*'
  - 'packages/**'
  - '!packages/examples/**'
```

Ship reads the packages list, leaving other pnpm settings to pnpm. Package patterns
support safe relative directories, `*`, `**` and `!` exclusions. The pnpm list can
use plain or quoted scalars or a JSON-style inline array. Brace expansion, extglobs,
YAML anchors/aliases and complex packages-list syntax are rejected explicitly.

The selected app and each build dependency must be included by these patterns and
stay inside the repository, including directory symlink targets. Nested lockfiles
and nested pnpm workspace roots are rejected. A package-level `packageManager`, if
present, must agree with the root pin. Use dependency declarations supported by
your package manager; npm local packages can use a matching workspace version,
while pnpm and Yarn support `workspace:*` links.

## Development and production dependencies

All workspace dependencies install from the root lockfile with the pinned manager.
The root and every discovered package get separate named `node_modules` volumes
in development. This handles hoisted npm modules and package-local pnpm links
without populating host dependency folders. Volume identities depend on package
paths, so service renaming does not reassign package dependencies.

The app, `ship npm`/`ship pnpm`/`ship yarn` proxies, workers and deploy commands run from the
selected app directory. Package-manager proxies therefore operate in that app's
workspace context. To operate at the root explicitly, use an app exec command
that changes to `/app`.

Generic Node/Express/Fastify/NestJS production builds prune development dependencies
at the repository root and preserve the complete repository layout. This keeps local workspace links and
shared packages' runtime dependencies usable. This first strategy retains other
workspace sources and production dependencies; it does not produce a minimal
selected-app dependency closure. Production images have no source bind mounts,
and exported releases boot without a host source checkout or install step.

Workspace builds copy the excluded repository context before installation so all
workspace manifests and install hooks are present. This sacrifices manifest-only
install caching: source changes can invalidate the dependency layer. Existing
[build-secret and context protections](build-environment.md) still apply.

## Framework scope and verification

Workspace Node packaging supports generic Node, Express, Fastify and NestJS with
the complete repository layout, and isolated Next.js standalone/Nuxt Node output
with the layouts described below. SvelteKit, Astro, Angular SSR and TanStack Start
workspace Node outputs remain rejected until their output/dependency layouts have
a dedicated strategy. Gatsby workspace adapter placement is also rejected.
Standalone framework support is unchanged.

Static strategies use build output relative to the selected application. A real
React/Vite workspace build has passed development serving, ordered shared-package
builds, subpath assets and Node-free Nginx production packaging. Other static
framework workspace modes still need representative live tests.

npm 12.2.2, pnpm 12.21.0 and Yarn 4.18.1 generic Node fixtures passed shared TypeScript-library
builds, runtime dependencies imported through that library, development-volume
isolation, complete compiler removal (including pnpm virtual-store copies),
non-root execution and source-free portable-release boot. Yarn requires build
binaries to be declared by the workspace that invokes them; declare tools such
as TypeScript in that package's development dependencies. The React/Vite
workspace static fixture also passed with Yarn 4.18.1. Other package-manager
versions and operating-system Docker variants require more coverage.

## Next.js standalone workspaces

For an application at `apps/web`, use `ship init --workspace apps/web` and configure
Next's tracing root to the repository root. Ship does not execute next.config on
the host or change this setting for you. For example, `apps/web/next.config.mjs`:

```js
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../..', import.meta.url));
export default {
  output: 'standalone',
  outputFileTracingRoot: root,
  turbopack: { root },
};
```

The build must produce
`apps/web/.next/standalone/apps/web/server.js`. Ship copies the complete traced
standalone tree into `/app`, preserving repository-relative dependency paths,
then adds the selected app's `.next/static` and optional `public` under
`/app/apps/web`. Production starts `node server.js` from `/app/apps/web`.
A flattened standalone tree, a tracing root outside/different from the repository
or a custom `distDir` is not supported by this strategy. Missing expected output
fails the build with tracing-root guidance.

Use `outputFileTracingIncludes` when Next needs runtime data or dynamic imports
that its trace cannot discover. Those patterns are relative to the Next app,
not the repository root. `serverExternalPackages` may be appropriate for packages
that should remain external to the server bundle. Ship only packages what the
framework emitted; it does not infer missing dependencies or copy every shared
workspace into a standalone image. See [Next output tracing](https://nextjs.org/docs/app/api-reference/config/next-config-js/output).

## Nuxt Node workspaces

Select the app in the same way. Ship installs at the repository root, builds
explicit shared dependencies in order, then builds Nuxt with
`NITRO_PRESET=node-server`. It copies the app's generated `.output` into
`/app/apps/web/.output`, and starts `node .output/server/index.mjs` from
`/app/apps/web`. Root `node_modules`, workspace source folders and unrelated
packages are not copied into that runtime. Shared code and runtime dependencies
must be included by the generated Nitro output. See [Nuxt Node deployment](https://nuxt.com/docs/4.x/getting-started/deployment).

For both isolated strategies, `runtimeFiles` remains relative to the selected app
and is copied beneath its runtime app directory. Workers and explicit deploy
commands use that same working directory and production environment. Supply
self-contained/bundled worker or migration files and ensure their dependencies
are present in the traced/bundled output; package-manager scripts and a complete
workspace install are not supplied automatically. Use the generic Node workspace
strategy when those commands need the complete repository dependency layout.

Output validation rejects absolute or dangling symlinks and relative links
escaping the isolated runtime. It validates relocatable links, not every dynamic runtime import.
Review generated-file edits before `ship init --force` when changing packaging
settings. The standard format-8 marker includes an isolated-workspace revision
for these new strategies.

Local representative checks cover npm/Next.js and npm/Nuxt shared-package imports,
SSR, assets, workers and copied source-free releases. Planning checks cover
npm/pnpm/Yarn. The Nuxt fixture emits an ESM shared library; a CommonJS shared
library using `require('is-number')` produced a Nitro runtime interop failure
(`isNumber is not a function`). Use an output format/configuration compatible
with Nitro; Ship does not rewrite module interop. Next's fixture reads runtime
data relative to the app's working directory and includes it explicitly in the
trace; Turbopack's virtual `__dirname` did not work for that fixture's development
bundle. Live pnpm/Yarn SSR-workspace builds, native dependencies, additional
module formats/framework versions and other Docker host platforms need coverage. See
[verification](verification.md).

## Programmatic Compose generation

Use the asynchronous project-aware helper for a workspace:

```js
import { readConfig, buildProjectCompose } from 'js-ship';
const config = await readConfig(projectRoot);
const compose = await buildProjectCompose(config, projectRoot, 'production');
```

`buildCompose` remains synchronous for callers with already resolved layout data.
For workspace inputs it requires a fifth argument listing the resolved package
paths; otherwise it fails with guidance to use `buildProjectCompose`.

The package-manager behavior follows the [npm workspace documentation](https://docs.npmjs.com/cli/v11/using-npm/workspaces/)
and [pnpm workspace settings](https://pnpm.io/settings). pnpm production pruning
is described in [pnpm prune](https://pnpm.io/cli/prune).
