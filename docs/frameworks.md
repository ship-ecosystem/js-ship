# Framework deployment modes

All fourteen requested adapters are implemented, plus `generic`. This is an early
implementation with unit/planning/output-file tests and representative live Docker
builds for all fourteen frameworks. See the [tested versions and limits](verification.md).
Chromium checks also verify component/CSS HMR for Vite React/Vue/Svelte through
published ports, including subpaths, without reloading or resetting an unchanged
parent's counter. Browser HMR for the other adapters remains unverified. Support refers to the
specific deployment shapes below, not every historical framework version or host.

| Key | Default mode | Implemented modes | Production shape |
| --- | --- | --- | --- |
| react | static | static (Vite) | `dist/`, Nginx SPA routing |
| vue | static | static (Vite) | `dist/`, Nginx SPA routing |
| angular | static | static, node | Modern application builder, production configuration |
| svelte | static | static (Vite) | `dist/`, Nginx SPA routing |
| nestjs | node | node | `build`, then `start:prod` |
| fastify | node | node | Optional build, then `start` |
| expressjs | node | node | Optional build, then `start` |
| next | node | node, static | `.next/standalone` or `out/` |
| nuxt | node | node, static | Nitro `.output/` or generated `.output/public/` |
| sveltekit | node | node, static | `adapter-node` or `adapter-static`, `build/` |
| astro | static | static, node | Static `dist/` or `@astrojs/node` standalone |
| vitepress | static | static | `<root>/.vitepress/dist`, generated HTML |
| tanstack-start | node | node (Nitro/Vite) | `.output/server/index.mjs` |
| gatsby | static | static | `public/`, generated Ship Gatsby adapter required |
| generic | node | node | Existing project scripts; copies the project runtime |

Select a mode with `ship init --deployment node` or `--deployment static`.
The `deployment` field is committed to `ship.json`. Switching a mode/framework,
output path, entrypoint or runtimeFiles changes the Docker template contract;
review your edits and republish with `ship init --force`. Configuration JavaScript
is never evaluated on the host to discover these settings.

## Next.js

Node mode requires `output: 'standalone'` in your existing Next config. Ship checks
for `.next/standalone/server.js`, copies the traced standalone runtime, then adds
`.next/static` and optional `public/`. It starts `node server.js` with
`HOSTNAME=0.0.0.0` and `PORT`. Monorepo/custom distDir layouts are not supported.

Static mode requires `output: 'export'`. Ship cleans the old output before building
and requires a fresh `out/index.html`; an old export cannot accidentally pass the
check after switching to a Node-only config. The app runs in Nginx with HTML
routing. Both `trailingSlash: false` and `true` have live portable-release and
Chromium hydration/client-navigation coverage. Nginx resolves a trailing-slash URL
to either its directory index or adjacent HTML, so route-payload directories do
not cause 403 responses in the default export layout. Older Next static templates
require review and `ship init --force` to pick up this routing fix.
Next.js basePath/subpath support is not implemented yet; Ship requires `/`.

Public build variables (`NEXT_PUBLIC_*`) are not runtime variables. Ship does not
yet provide a public build-env allowlist; never put private values into them.

## Nuxt and TanStack Start

Node mode selects `NITRO_PRESET=node-server` during the build and checks for
`.output/server/index.mjs`. Only `.output/` is copied into the runtime. Configure
the Nitro Vite plugin in TanStack Start; Rsbuild, edge and serverless targets are
not supported by this adapter. Package detection recognizes React and Solid Start.

Nuxt static mode uses a `generate` package script that runs `nuxt generate` and
serves `.output/public/`. TanStack Start static output is not implemented. Both
adapters currently require Ship `basePath: '/'`.

The Nuxt 4.6.4 live fixture pins `npm@11.20.0`. Its initial npm 12.2.2 install
failed with `EALLOWREMOTE` on a bundled `@parcel/watcher-wasm` registry tarball,
before framework startup. Ship preserves npm's install policies; this dependency
graph has not been verified with npm 12. Use matching package-manager and lockfile
pins and consult [verification notes](verification.md) for the tested combination.

## SvelteKit

Install and configure `@sveltejs/adapter-node` or `@sveltejs/adapter-static`.
SvelteKit 3 configures it through `sveltekit({ adapter: adapter() })` in
`vite.config.js`; older SvelteKit 2 projects can use `kit.adapter` in
`svelte.config.js`. A dependency declaration alone does not configure the adapter.
See the [official adapter configuration](https://svelte.dev/docs/kit/adapters).

Node mode copies `build/`, package.json and production node_modules, then runs
`node build/index.js`. Set `ORIGIN` or the appropriate trusted-proxy configuration
for your deployment through runtime environment values.

Static mode requires a root index page (prerendered or an adapter-static fallback).
HTML routing is the default; use `staticRouting: 'spa'` for an intentional SPA
fallback. Node handler output is rejected in static mode. Ship subpaths are not
yet supported for SvelteKit.

## Astro

Static mode builds and serves `dist/`. If Astro emits `dist/server/entry.mjs`, Ship
rejects static packaging because it would drop on-demand routes/server islands.
Choose Node mode for these features.

Node mode requires `@astrojs/node` configured with `mode: 'standalone'`, for example:

```js
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
export default defineConfig({ output: 'server', adapter: node({ mode: 'standalone' }) });
```

Ship copies `dist/` and production dependencies and runs `node dist/server/entry.mjs`.
Astro middleware mode requires your own server and is not supported here. Static
mode passes `basePath` to both Astro CLI development and build commands and aligns
Nginx routing with it; Node mode currently requires `/`.

## Angular

Requires the modern application builder and its `outputMode` support (Angular 19+
deployment shape). Init reads `angular.json` as data. A single application is
selected automatically; use `--angular-project NAME` for a multi-application Angular
workspace. npm/pnpm package workspaces remain unsupported.

The package scripts must be `ng serve` and `ng build` without embedded project
selection. Ship appends the selected application and production configuration.
Output paths are taken from the merged production settings, including an object
outputPath's base/browser/server directories. A production configuration is required.

Static mode passes `--output-mode static` and `--base-href`. Nginx uses
`index.csr.html` as the SPA fallback and preserves any prerendered root index.
If the build emits just one of these host files, Ship supplies the other.

Node mode requires configured Angular SSR, copies the entire app output plus
production dependencies, and runs its `server/server.mjs` (or the configured
server output directory). Legacy browser/Universal builders are not implemented.

Angular SSR validates request hostnames. Development sets `NG_ALLOWED_HOSTS` to
`localhost,127.0.0.1` by default so Ship's published loopback URL works; override
it in `.env` for another development hostname. Production keeps the application's
host policy. Configure your actual hostname in Angular's `security.allowedHosts`
or set `NG_ALLOWED_HOSTS=app.example.com` in `.env.production`. See
[Angular's host validation guidance](https://angular.dev/best-practices/security#preventing-server-side-request-forgery-ssrf).

## Gatsby

Requires Gatsby 5.12+ and its public adapter API. The root package must omit `type`
or use `"type": "commonjs"`; Ship rejects `"type": "module"` because Gatsby's CLI
launches a CommonJS temporary script that fails in that scope. Merge this into
your existing `gatsby-config.js` after `ship init` publishes the adapter:

```js
const shipStatic = require('./ship/gatsby-adapter.cjs');
module.exports = { adapter: shipStatic(), trailingSlash: 'always' };
```

An ESM configuration can use `gatsby-config.mjs` in the CommonJS project:

```js
import shipStatic from './ship/gatsby-adapter.cjs';
export default { adapter: shipStatic(), trailingSlash: 'always' };
```

The generated adapter
rejects SSR, deferred generation, functions, custom redirects/headers and wildcard
client routes. It emits a fresh build report; packaging refuses to proceed without
that report. An earlier report is removed before each Docker build. Only root
hosting with `trailingSlash: 'always'` is supported in this initial implementation.

Gatsby's built-in cache/security header rules are accepted. Nginx preserves the
built-in security headers and conservatively uses
`Cache-Control: public, max-age=0, must-revalidate` for every file, including hashed
assets. Custom header names, values or route patterns remain unsupported.
Older generated Gatsby templates require `ship init --force` after reviewing
your edits; metadata checks prevent using the earlier helper that rejected the
built-in rules.

Native installer permissions remain project-owned. The live npm 12 fixture
explicitly approves `sharp@0.32.6` through `package.json`'s `allowScripts` field;
Ship does not approve dependency scripts automatically. See
[npm's install policy](https://docs.npmjs.com/cli/v12/commands/npm-install/).

## Runtime files and customized output

Framework Node output is isolated from the original source checkout. SvelteKit,
Astro and Angular include production dependencies; Next standalone and Nitro
use their traced/bundled dependencies. To include a separate compiled worker,
migration or supporting file, list explicit build-relative paths:

```json
{
  "runtimeFiles": ["workers/job.js", "migrations"],
  "processes": { "worker": ["node", "workers/job.js"] }
}
```

Commands must have their dependencies included too. For example, an ORM used only
by a worker may need explicit production dependencies beyond a Next standalone
trace. Self-contained Nitro output does not automatically include project scripts
or top-level node_modules. Generic/Express/Fastify/NestJS packaging still uses the
project's production start script and copies its project runtime.

Bundle adapters allow a safe relative `outputDirectory` and optional `serverEntry`
inside it, matching the framework's actual build configuration. Next uses standard
paths only. File checks validate packaging requirements; they cannot establish
that arbitrary application code starts correctly. Live HTTP/release tests remain
required before a public release.

## References

- [Next standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output)
- [Nuxt deployment](https://nuxt.com/docs/4.x/getting-started/deployment)
- [SvelteKit adapter-node](https://svelte.dev/docs/kit/adapter-node)
- [Astro Node adapter](https://docs.astro.build/en/guides/integrations-guide/node/)
- [Angular deployment](https://angular.dev/tools/cli/deployment)
- [TanStack Start hosting](https://tanstack.com/start/latest/docs/framework/react/guide/hosting)
- [Gatsby adapter API](https://www.gatsbyjs.com/docs/how-to/previews-deploys-hosting/creating-an-adapter/)
