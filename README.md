# JavaScript Ship

Docker development environments and portable production releases for JavaScript
and TypeScript applications, following the PHP and Python Ship workflow.

**Status: early development. Not published or production-ready.**
The npm package name is `js-ship`; publishing remains blocked with `private: true`
until release checks are complete. Once published, install it with
`npm i js-ship` and run `npx ship --help`. The first public tests will use
`npm i js-ship@next`; see [npm release preparation](docs/npm-release.md) and
[the changelog](CHANGELOG.md).

Implemented now: all fourteen requested framework adapters, generic Node apps,
pinned npm/pnpm/Yarn 4 workflows, PostgreSQL, Redis, MongoDB, named instances, production
workers and portable release assembly. All adapters have planning/template and
output-file tests; representative framework builds and infrastructure also
have live Docker coverage. Tested versions and remaining gaps are recorded in
[verification notes](docs/verification.md). Operational steps are in
[startup, shutdown and recovery](docs/recovery.md). Modes and setup
requirements are documented in [framework deployment modes](docs/frameworks.md)
and [MongoDB](docs/mongodb.md). Build variables, temporary secrets and private
npm/pnpm registry configuration are covered in [build environment](docs/build-environment.md). See
[the spec](docs/spec.md) and [roadmap](docs/roadmap.md) for their scope and status.

Interactive setup and automation flags, plus `doctor --json` diagnostics, are
documented in [initialization and diagnostics](docs/usability.md). External
PostgreSQL/Redis/MongoDB connections and a runnable repository example are covered
in [external services](docs/external-services.md); build/runtime/browser values
are explained in [environment boundaries](docs/environment.md).

## Run from this checkout

Requires patched Node 22.23.5+, 24.22.3+ or 26.13.1+ within those majors, npm,
Docker Engine/Desktop and Compose 2.24.0+. The application must
have one committed npm, pnpm or Yarn lockfile. Init detects the framework and package
manager from package.json and lockfiles without running application scripts on the
host. Explicitly configured [extensions](docs/extensions.md) do execute host code.
npm/pnpm/Yarn workspaces can select an app with `ship init --workspace apps/api` from
the repository root. See [workspaces](docs/workspaces.md) for build order and
packaging limits. See [Yarn 4 setup](docs/yarn.md) for its required node_modules
linker and current scope. Bun is not implemented yet.

```sh
npm ci
npm run build
node dist/cli.js --help
node dist/cli.js --project-directory /absolute/path/to/app init --database postgres --cache redis
node dist/cli.js --project-directory /absolute/path/to/app up
```

`examples/node` is a dependency-free app you can copy to a temporary directory
to try this workflow. It listens on `HOST` and `PORT` and uses Node watch mode.
Generic apps must bind `0.0.0.0`; Ship supplies `HOST=0.0.0.0` and `PORT=3000`.
Init offers a terminal picker; use `--no-interaction` for deterministic automation.

## Configuration in your editor

`ship init` links `ship.json` to a generated local `ship/ship.schema.json` for
completion and validation without network access. Commit both files and run
`ship config:test` for project-aware checks. See [configuration](docs/configuration.md)
for the complete editor/tooling contract and schema export.

## Framework adapters

| Adapter key | Development/build defaults | Production |
| --- | --- | --- |
| `generic` | `dev`, optional `build` | `start` script in Node |
| `expressjs`, `fastify` | `dev`, optional `build` | `start` script in Node |
| `nestjs` | `start:dev`, `build` | `start:prod` script in Node |
| `react`, `vue`, `svelte` | Vite `dev` and `build` scripts | Static `dist/`, SPA routing, unprivileged Nginx |
| `vitepress` | `docs:dev`/`docs:build` (or `dev`/`build`) | Generated HTML, proper 404s, unprivileged Nginx |
| `next` | `dev`, `build` | Standalone Node or static export |
| `nuxt` | `dev`, `build` or `generate` | Nitro Node output or generated HTML |
| `sveltekit` | `dev`, `build` | Node or static adapter output |
| `astro` | `dev`, `build` | Static or standalone Node output |
| `angular` | `ng serve`/`ng build` package scripts | Modern Angular static/SSR output |
| `tanstack-start` | `dev`, `build` | Nitro/Vite Node output |
| `gatsby` | `gatsby develop`/`gatsby build` scripts | Static output with generated Gatsby adapter |

Specific framework detection wins over base libraries: Next.js before React,
Nuxt/VitePress before Vue, SvelteKit before Svelte, and NestJS before its HTTP
transport. An explicit `--framework` selection takes precedence. Choose modes
using `ship init --deployment node|static`. Gatsby is static-only; TanStack Start
currently targets Node through Nitro/Vite. Framework-specific adapter configuration
remains in the application's own config; Ship validates expected output during builds.

Node server adapters run your existing scripts. The application must listen on
`0.0.0.0` and honor `PORT`; Ship supplies `HOST` and `PORT` but does not rewrite
Express/Fastify/NestJS application source.

Vite adapters currently require a direct Vite dev script and a build script
ending in `vite build` (e.g. `vue-tsc -b && vite build`). SSR builds require a
server adapter. VitePress scripts must directly invoke `vitepress dev`/`build`
with the same literal root directory. Custom output directories are explicit in
`ship.json`; configuration JavaScript is never evaluated for detection.

## Configuration

```json
{
  "framework": "generic",
  "node": "24",
  "packageManager": "npm",
  "packageManagerVersion": "12.2.2",
  "scripts": { "dev": "dev", "build": "build", "start": "start" },
  "port": 3000,
  "services": { "database": "postgres", "cache": "redis" },
  "additionalServices": [
    { "group": "database", "service": "postgres", "name": "analytics" }
  ],
  "processes": { "worker": ["node", "dist/worker.js"] },
  "deployCommands": [["npm", "run", "db:migrate"]]
}
```

Use `"build": null` for generic/Express/Fastify apps without a build script. Processes run only in
production, each in its own container. Database connection variables are
`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`; named instances prefix
them with `ANALYTICS_`. Redis supplies `REDIS_URL`. Ship does not install drivers.

`ship init` writes `ship.json` and the `ship/` directory: Dockerfiles, entrypoints,
output checks, packaging metadata, and the selected framework/database helpers.
Commit ship.json and the entire ship/ directory. Edited templates survive
reinitialization; `--force` replaces them. Changing the package manager, framework,
deployment mode, output/base path, entrypoint or runtime files requires
`ship init --force` after reviewing template edits. Older template formats also
require this refresh. Generated Compose files are disposable. Development
commands honor `docker-compose.override.yml` or `compose.override.yaml`.

Development binds HTTP to localhost at `APP_PORT` or the configured framework port. Application dependencies
live in a named container volume. Startup uses `npm ci` or a forced, frozen pnpm
install to refresh dependencies after branch/runtime changes. Rebuild with
`ship up` after changes. Each explicit development `up` recreates the app so its
install runs even when Compose configuration is unchanged; infrastructure follows
normal Compose change detection. Host `node_modules` is unused. Project lifecycle scripts
execute inside containers according to the package manager's policy.

## Package managers

`packageManager` selects `npm` or `pnpm`; `packageManagerVersion` pins its exact
version inside the image. Init honors an exact package.json declaration such as
`"packageManager": "pnpm@12.21.0"`. npm defaults to the explicit pin in
`src/versions.ts`. pnpm requires a manifest pin or explicit init flags:

```sh
ship init --package-manager pnpm --package-manager-version 12.21.0
ship pnpm add zod
# npm projects use: ship npm install zod
```

Conflicting lockfiles, mismatched manifest/config versions and unsupported package
managers fail before writing files. A proxy for the wrong manager also fails.
Dependency commands run inside the running development app and update the
bind-mounted manifest and lockfile. Frozen installs are used for builds.

## Static sites

Static adapters do not need a production `start` script. They build with Node and
copy only the output directory into an unprivileged Nginx runtime (port 8080).
Their app containers receive no Ship infrastructure credentials or env_file.
Workers and deploy commands belong in a backend project because static images
contain no Node runtime. Selecting infrastructure still provisions its containers.

```json
{
  "framework": "react",
  "scripts": { "dev": "dev", "build": "build", "start": null },
  "outputDirectory": "dist",
  "staticRouting": "spa",
  "basePath": "/portal/"
}
```

Init fills the other fields. `basePath` defaults to `/` and must have leading and
trailing slashes. Ship passes it to Vite/VitePress in development and build, and
aligns Nginx routing and output placement. VitePress defaults to `html` routing,
with a detected `<root>/.vitepress/dist` output directory. SPAs use an index.html
fallback for application routes; missing assets still return 404. Vite/VitePress
default to development port 5173; other frameworks keep their own port defaults.
Static production maps APP_PORT to container port 8080
only with `publishPorts: true`.

Build-time public environment configuration is not yet supported. Env files and
registry credentials are excluded from the build context; a static runtime's env
cannot change values already bundled into its JavaScript.

## Commands

Use `node /absolute/path/to/com.ship.js/dist/cli.js` as `ship` until installed.

| Command | Behavior |
| --- | --- |
| `init [--database postgres] [--cache redis]` | Publish validated configuration/templates; `none` removes a selection |
| `up` | Build/start development, wait for containers and an HTTP response |
| `down [--volumes]` | Stop; `--volumes` deletes persistent service/dependency data |
| `exec SERVICE COMMAND...` | Forward a command and arguments unchanged |
| `shell [SERVICE]` | Open sh, defaulting to app |
| `logs [SERVICE] [-f]` | Show or follow logs |
| `db [INSTANCE]` | Open psql or mongosh inside the selected database |
| `npm ARGUMENTS...` | Run npm in app |
| `pnpm ARGUMENTS...` | Run pnpm in a pnpm app |
| `config:test` | Validate project, both Compose models and production credentials without Docker |
| `doctor` | Display Docker/Compose versions and stack state |
| `build` | Build each unique project-owned production image; workers share the app image |
| `release --tag TAG` | Build/export every image into a portable release |

`--project-directory PATH` goes before the command. Proxy flags are forwarded
unchanged and the inner exit code is returned. Piped input disables Compose TTY.

## Production

Create `.env.production`; selecting Postgres requires a unique `DB_PASSWORD`
(and `ANALYTICS_DB_PASSWORD` for the example named instance). MongoDB requires
`MONGODB_PASSWORD` and `MONGODB_ROOT_PASSWORD`, with matching prefixes for named
instances; see [MongoDB setup](docs/mongodb.md). Release always
requires the file, even if it is empty. Production rejects the built-in default.
Secrets stay out of the Docker build context. Private registry credentials and
build-time secret configuration are not supported by this milestone.

```sh
ship config:test
ship build
ship release --tag v1.0.0
```

The artifact under `dist/ship/v1.0.0/` includes image archives, checksums,
`docker-compose.yml`, `.env`, deployment instructions and optional once-per-deploy
commands. The target needs Docker/Compose and compatible CPU architecture. No
source checkout or build is required. Existing tags are preserved. The artifact
contains secrets and must be kept private.

Production app images run as an unprivileged user and publish no ports by default. Attach
a reverse proxy to the Compose network, or explicitly set `publishPorts: true`.
`serviceNames` renames services without changing data volume identities; stop
the current stack before renaming stateful services.
`externalNetwork` attaches the app and its processes to an existing network.

Production app and worker containers use `restart: unless-stopped` and a 60-second
stop grace period. Keep commands in the foreground. The entrypoint forwards
SIGINT/SIGTERM to the non-interactive command's process group and waits for its
children to drain, including commands launched through npm or a shell. Interactive
execs keep their existing terminal session. Crashed workers restart; manually
stopped workers remain stopped until started again.

The supervisor was introduced in format 4; current extension-aware templates use
format 8. For an existing project,
review your generated-file edits and run `ship init --force` to refresh the
entrypoint before using this package update.

## Custom adapters and services

[Extension API v1](docs/extensions.md) loads explicit local JavaScript modules into
an isolated project registry. It supports validated framework/service definitions,
owned volumes, namespaced templates and a generated schema with custom choices.

## Runtime maintenance

Default runtime images are digest-pinned, and Ship checks reviewed Node minimums
on the host and during image builds. See [runtime maintenance](docs/runtime-maintenance.md)
for updates, template refreshes and the [security policy](SECURITY.md).

## Development checks

```sh
npm run check
npm run test:package  # install and exercise the built tarball in a separate project
npm run test:docker   # live Docker daemon; pulls/builds images and cleans up its test stack
npx playwright install chromium  # one-time browser setup for the development checkout
npm run test:browser  # real Chromium HMR checks against Docker development apps
npm run test:transfer # export a test release, remove its source/image, then verify the artifact
npm pack --dry-run
```

The unit suite covers config errors, rename/data stability, literal command
arguments, secrets, template preservation, development overrides, release
staging/deduplication/checksums, and HTTP readiness. Release-boundary tests use a
recording runner, not Docker. The Docker suite exercises development, npm/pnpm/Yarn
dependency refresh, Vite component builds, Node server and SSR/static builds,
MongoDB transactions/change streams, database persistence, worker crash/manual
restarts, graceful process-tree shutdown and source-free releases. Browser checks
cover React/Vue/Svelte component and CSS HMR through published ports while retaining
state in an unchanged parent, and Next.js static-export hydration and client navigation.
They capture traces/screenshots under `test-results/`
on failure. `SHIP_BROWSER_EXECUTABLE` can select an existing Chromium installation;
Linux CI installs its browser dependencies with Playwright. This is a development
dependency only; installed Ship has no runtime dependencies.
GitHub workflows are currently disabled to conserve Actions minutes; they will run
only after explicit pre-release authorization. Quality, Docker and browser
workflows are prepared. A separate release-transfer
workflow exports a fixture on one runner and boots its artifact on another, with no
application source checkout, npm install, image build or registry pull on the consumer.
Only its generated test `.env` is transferred; the workflow does not upload an actual
project's production environment. See [verification notes](docs/verification.md) for run status.

In a restricted session that cannot spawn child processes or bind sockets, run:

```sh
SHIP_RESTRICTED_TEST=1 node --test --experimental-test-isolation=none test/*.test.mjs
```

This explicitly skips the subprocess/socket tests; it does not replace the
normal suite or Docker verification. See [verification notes](docs/verification.md).
