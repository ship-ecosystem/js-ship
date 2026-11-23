# JavaScript Ship

Docker development environments and portable production releases for JavaScript
and TypeScript. Part of the [Ship ecosystem](https://github.com/ship-ecosystem),
alongside [PHP Ship](https://github.com/ship-ecosystem/php-ship) and Python Ship.
The packages share the `ship.json` vocabulary, container workflow and
[`ship-release` contract](https://github.com/ship-ecosystem/spec/blob/main/docs/release-contract.md).
Language adapters supply the differences in runtime, build output and console tools.

**Private development build; npm publication and final release CI are pending.**
The intended install is `npm i js-ship` (`npm i js-ship@next` for public prereleases).
The package is currently `private: true` at `0.1.0-dev.0`; these are future registry
commands, not a claim that a public package is available. Use the checkout below.
See [release preparation](docs/npm-release.md), [verification](docs/verification.md)
and [ecosystem compatibility](docs/ecosystem-parity.md) for evidence and limits.

## Contents

- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Commands](#commands)
- [Services](#services)
- [Framework adapters](#framework-adapters)
- [Configuration](#configuration-shipjson)
- [Production releases](#production-releases)
- [HTTPS / TLS](#https--tls)
- [Backing up data volumes](#backing-up-data-volumes)
- [Development servers and file ownership](#development-servers-and-file-ownership)
- [Faster file sync](#faster-file-sync)
- [Running more than one project](#running-more-than-one-project)
- [Customizing and extending Ship](#customizing-and-extending-ship)
- [Architecture](#architecture)
- [Contributing](#contributing)

## Requirements

- Patched Node 22.23.5+, 24.22.3+ or 26.13.1+ within those majors on the host.
- Docker Engine/Desktop with Linux containers and Compose 2.24.0+.
- An application package.json and one committed npm, pnpm or Yarn lockfile.
- A pinned package manager: npm, pnpm or Yarn 4 with the node_modules linker.

Ship itself is compiled ESM; consumers need no TypeScript runner. It reads project
manifests/configuration as data and runs application tools inside containers.
Explicit [extension modules](docs/extensions.md) execute trusted host code.
Bun, Yarn Classic/Plug'n'Play and arbitrary framework output modes are not supported.
Framework/version/platform limits are listed in [frameworks](docs/frameworks.md).

## Quick start

From this checkout:

```sh
npm ci
npm run build
node dist/cli.js --project-directory /absolute/path/to/app init
node dist/cli.js --project-directory /absolute/path/to/app up
```

After npm publication, use `npx ship` in an application that installed `js-ship`.
The examples below call that executable `ship`. You can copy `examples/node` to a
temporary directory for a minimal project.

`init` offers a rich terminal wizard: application name, workspace/framework,
runtime/package manager, service categories/providers, named instances, production
processes and external networks. Ctrl+U goes back; Ctrl+C cancels. Plain terminals
get numbered prompts. A final summary and file preview precede writes. Re-running
init retains settings and edited templates; `--force` explicitly replaces templates.
See [initialization and diagnostics](docs/usability.md).

Automation uses the same planner without questions:

```sh
ship init --no-interaction --name my-app --framework generic \
  --database postgres --cache redis --service mail=mailpit
ship up
ship npm install zod
ship down
```

Init publishes `ship.json`, Dockerfiles, entrypoints, offline editor schema and
framework helpers under `ship/`. Commit these and the lockfile. Missing development
settings are appended to `.env`/`.env.example`; `.env.production.example` contains
placeholders for required production settings. Existing values/comments survive.
Do not commit `.env`, `.env.production`, private registry configuration or build secrets.

## Commands

| Command | What it does |
| --- | --- |
| `ship init [--force] [--no-interaction]` | Configure services/runtime/processes and publish generated files |
| `ship up` | Build/start development, refresh dependencies, wait for services and HTTP |
| `ship down [--volumes]` | Stop development; `--volumes` also deletes persisted data/dependencies |
| `ship exec SERVICE COMMAND...` | Run an arbitrary command in a running service |
| `ship shell [SERVICE]` | Open sh; defaults to app |
| `ship logs [SERVICE] [-f]` | Show or follow logs |
| `ship db [INSTANCE]` | Open the selected database's client shell |
| `ship npm|pnpm|yarn ARGUMENTS...` | Proxy the selected package manager inside app |
| `ship package-manager TOOL[@VERSION] [--yes] [--force]` | Switch/update the tool in the running development container |
| `ship test [-- ARGUMENTS...]` | Run the selected browser testing tool after `ship up` |
| `ship config:test` | Validate project, templates, both Compose models and production credentials without Docker |
| `ship doctor [--json]` | Diagnose Docker/Compose, effective configuration and service state without changing the project |
| `ship build [--no-cache]` | Build every unique project-owned production image |
| `ship release --tag TAG [--no-env] [--force]` | Assemble the portable production release |

`--project-directory PATH` goes before the command. Proxies forward flags and exit
codes unchanged. Non-terminal execution disables Compose TTY allocation. Package
manager proxies refuse a tool that conflicts with the selected lockfile. Node
framework consoles and ORM commands use package scripts (`ship npm run migrate`,
for example); PHP-only artisan/composer shortcuts have no JS equivalent to expose.

## Services

| Group | Choices |
| --- | --- |
| database | PostgreSQL, MySQL, MariaDB, MongoDB, SQL Server |
| cache | Redis, Valkey, Memcached |
| storage | SeaweedFS, Garage, RustFS, Silo |
| search | Meilisearch, Elasticsearch, Typesense |
| mail | Mailpit |
| broker | RabbitMQ |
| broadcasting | Centrifugo |
| testing | Playwright, Cypress, Selenium |
| queue-dashboard | Bull Board |

Each group has one primary provider. `additionalServices` adds named instances;
`serviceNames` changes Compose names without changing persistent resource identity.
Containers expose connection settings; applications install their own client SDKs.
See [services](docs/services.md) for provider settings, storage provisioning,
SQL Server licensing/architecture and browser test instructions. MongoDB supports
authenticated standalone or single-member replica sets; the latter supports
transactions/change streams but provides no redundancy. See [MongoDB](docs/mongodb.md).
Hosted databases need no local selection: see [external services](docs/external-services.md).

BullMQ workers and Socket.IO/ws servers are app-owned `processes` sharing the app
image. See [processes](docs/processes.md) for lifecycle and packaging guidance. Bull Board and Centrifugo are independently managed services. WebdriverIO
connects to Selenium as a runner/client. Octane, Reverb and Dusk are PHP-specific
and are not included. Browser tools never enter production releases.

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

## Configuration (`ship.json`)

```json
{
  "$schema": "./ship/ship.schema.json",
  "name": "my-app",
  "framework": "generic",
  "deployment": "node",
  "node": "24",
  "packageManager": "npm",
  "packageManagerVersion": "12.2.2",
  "scripts": { "dev": "dev", "build": "build", "start": "start" },
  "port": 3000,
  "services": { "database": "postgres", "cache": "redis" },
  "additionalServices": [{ "group": "database", "service": "mysql", "name": "analytics" }],
  "processes": {
    "worker": ["npm", "run", "worker"],
    "events": {
      "command": ["node", "dist/events.js"],
      "http": { "port": 4000, "role": "websocket", "health": "/ready", "urlSetting": "EVENTS_URL" }
    }
  },
  "deployCommands": [["npm", "run", "db:migrate"]],
  "externalNetwork": ["proxy", "observability"]
}
```

Use the application's real script names and existing compiled process files. For
Node apps without compilation, use `scripts.build: null`. Process commands accept
shell strings, argv arrays, or objects with `command`, optional `healthcheck` and
optional `http`. Deploy commands accept strings or argv. No commands run implicitly.
Processes start in production, not automatically during development.

`name` is a stable identity. Existing js-ship production project names retain the
`-production` suffix; do not change a deployed project's name without migrating its
volumes. Named instance variables use uppercase prefixes such as `ANALYTICS_`.
PostgreSQL uses `DB_DATABASE`/`DB_USERNAME`; additional provider settings are documented in
[services](docs/services.md). Secrets belong in environment files, not ship.json.

The local editor profile is generated from supported JS capabilities; unmodified
canonical schema copies are also bundled. JavaScript properties are registered in
the local shared-spec checkout and await publication there. Editor hints never
replace `ship config:test`. See [configuration](docs/configuration.md).

Workspaces select `workspace.app` and ordered `buildDependencies` paths at the
repository root. Root lockfile authority is preserved. See [workspaces](docs/workspaces.md)
for isolated SSR packaging and limits, and [Yarn](docs/yarn.md) for linker requirements.

Static adapters build with Node and copy output into unprivileged Nginx (port
8080). SPA routing and generated HTML routing differ; missing assets return 404.
Static runtimes contain no Node, workers or deployment commands and receive no
infrastructure credentials. See [framework modes](docs/frameworks.md).

## Production releases

Development and production are separate: `ship up` never deploys production.
Keep an explicit stable `name` in ship.json. Create `.env.production` from the generated example, replace every placeholder
with real credentials and run:

```sh
ship config:test
ship build
ship release --tag v1.0.0
# To provision secrets separately on the destination:
ship release --tag v1.0.1 --no-env
```

The production file is required when selected services or adapter requirements
need settings; secret-free apps can omit it. Built-in development credentials are
rejected. Public build values, temporary BuildKit secrets and private npm/pnpm
registry credentials have separate boundaries: see [build environment](docs/build-environment.md)
and [environment settings](docs/environment.md). Runtime `.env` cannot change
frontend values compiled into JavaScript. Build secrets never enter release files.

```text
dist/ship/TAG/
├── release.json          # canonical ship-release; written last
├── docker-compose.yml    # no builds or source mounts
├── images/*.tar          # project-built images, once per unique image
├── .env                  # optional; production secrets, mode 0600
├── deploy-commands.sh    # only when configured; mode 0755
└── README.md             # instructions for this particular artifact
```

The manifest describes image IDs, archive hashes, platform, source revision,
services/volumes, HTTP endpoints, environment names, external networks, deployment
commands and console prefixes. Third-party images are pinned by digest and pulled
from their registries on the destination. The default artifact is not a fully
offline bundle. Project-built infrastructure such as Garage/MongoDB is archived.

No source checkout, Ship installation or build is needed on the destination.
It needs Docker/Compose, a compatible platform, external networks and appropriate
settings. Follow the artifact's README to load archives, pull registry images,
run deployment commands and start services. Commands run once after infrastructure
and stop on failure. Nothing automatically runs migrations on every app boot.

Releases are staged in private directories and published only when complete.
Existing tags are refused unless `--force` explicitly requests replacement; the
previous folder is retained until the replacement has been assembled successfully.
Keep artifacts private when they contain settings. `--no-env` retains variable
names in metadata but omits values/files; provision destination settings yourself.
See [ecosystem compatibility](docs/ecosystem-parity.md) for local conformance checks.

Production app/worker images run unprivileged with init, foreground commands,
`restart: unless-stopped` and a 60-second shutdown grace period. The supervisor
forwards signals to child process groups. Static images run as UID 101. Review
custom template edits and use `ship init --force` to adopt template format 9.

## HTTPS / TLS

Terminate TLS at your reverse proxy (for example Caddy, Traefik or Nginx). Ship
records the container port and role of every declared HTTP entry point, including
WebSocket processes and dashboards. Create the external networks first and attach
the proxy and the relevant Ship services. `externalNetwork` accepts one name or a
list. Production ports are private unless `publishPorts: true` is selected.

Route to the actual Compose service name and container port; enable WebSocket
upgrades where required. Configure public URL settings and compile frontend public
URLs for the final domain. A proxy does not make an unauthenticated dashboard
private: configure appropriate access control. External database TLS remains the
application client's responsibility.

## Backing up data volumes

Persistent data survives normal `ship down` and redeployment. `--volumes` deletes
it. Keep tested backups outside Docker and outside release folders; image archives
are not database backups. Use provider-native consistent backups rather than
copying live database files. From a production release directory, PostgreSQL can
be backed up with:

```sh
umask 077
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > postgres.sql
```

Use the configured service name for renamed/named instances. Test restoration in
an isolated stack. Back up storage data and metadata together; changing passwords
in an environment file does not rotate credentials already stored in a volume.
See [recovery](docs/recovery.md) and [MongoDB operations](docs/mongodb.md).

## Development servers and file ownership

Adapters bind to `0.0.0.0` inside containers and publish HTTP on host loopback.
Vite adapters configure HMR through the published port; app-owned servers must
honor `HOST`/`PORT`. Framework-specific watching and browser coverage are documented
in [frameworks](docs/frameworks.md) and [verification](docs/verification.md).

Development uses the host UID/GID on Linux by default (`hostUser: false` opts out).
Node processes run unprivileged. Host node_modules is replaced by container-managed
dependency volumes; startup performs frozen/immutable installs and refreshes after
branch switches. Every explicit `ship up` recreates app to run that install;
infrastructure follows normal Compose change detection. Package lifecycle scripts
run inside containers according to package-manager policy.

## Faster file sync

`SHIP_MUTAGEN=1 ship up` optionally replaces bind mounts with a synchronized source
volume on machines where Docker Desktop filesystem performance is slow. Ship waits
for initial sync before installing dependencies and starting the app; `ship down`
terminates its session. Mutagen must already be installed. Production files,
secrets and host dependencies are excluded. See [sync](docs/sync.md).

## Running more than one project

Use distinct stable `name` values and available `APP_PORT` values in each project's
`.env`. Dashboard ports also have provider-specific settings. Docker project names
isolate networks/volumes; named instances have their own resource and variable
prefixes. Prefer loopback development ports and external proxy routing in production.

## Customizing and extending Ship

`ship up` uses the first existing `docker-compose.override.yml` or
`compose.override.yaml`; production releases ignore development overrides. Use
an override for additional mounts, tooling or development-only watch processes.
Generated Compose files are disposable; edit ship.json or the override instead.
Generated templates retain edits until an explicit `--force` refresh.

Custom boot commands belong in an app-owned wrapper/entrypoint kept in the image.
Use `deployCommands` for once-per-deployment work. Ensure worker/migration files
and dependencies are included in isolated framework outputs through `runtimeFiles`
and the documented packaging strategy.

[Extension API v1](docs/extensions.md) loads explicit local modules containing
framework adapters, services, owned volumes and namespaced templates. Optional
capabilities describe HTTP endpoints, required settings, console prefixes and
process suggestions. PHP-only runtime acceleration/debugging integrations are
replaced by Node/framework tooling rather than unrelated always-on containers.

## Architecture

- Configuration/parser and schemas validate authored settings and preserve ecosystem meanings.
- Framework adapters describe commands and Node/static/isolated output packaging.
- Service definitions contribute containers, settings, volumes and optional HTTP metadata.
- Compose planning owns dependency ordering, names, networks and environment boundaries.
- Init separates planning and confirmation from file publication; prompt rendering is replaceable.
- Release assembly shares deployment metadata with its executable script and stages artifacts atomically.
- A shell-free process runner forwards arguments, signals and exit status.

The package is TypeScript compiled to ESM with declarations. The pinned Clack
prompt dependency is loaded only for rich interaction; schema validators and browser
test tools remain development dependencies. See [implementation spec](docs/spec.md)
and [runtime maintenance](docs/runtime-maintenance.md).

## Contributing

```sh
npm run check
npm run check:spec -- ../com.ship.spec
npm run test:package
npm run test:docker
npm run test:browser
npm run test:transfer
npm run check:release -- /path/to/dist/ship/TAG
```

These are local commands. Docker/browser suites build or pull images and clean up
uniquely named fixtures. Browser setup and tested versions are in
[verification](docs/verification.md). Keep schema/image generation current and add
meaningful boundary or live checks for behavior changes.

**GitHub Actions remain disabled to conserve the free-account budget.** Do not
push, enable or dispatch CI until explicitly authorized for pre-release checks.
Publishing, visibility changes, npm trusted-publisher setup and tags are separate
release steps. See [roadmap](docs/roadmap.md), [release readiness](docs/alpha-readiness.md)
and [changelog](CHANGELOG.md). Report security issues as described in [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE.md](LICENSE.md).
