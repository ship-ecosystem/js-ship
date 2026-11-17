# JavaScript Ship implementation spec

Status: initial implementation, November 2026. This document distinguishes the
agreed product scope from the first executable milestone. PHP and Python packages
remain unchanged. The working npm name is `@ship-ecosystem/js`; ownership and
availability must be confirmed before publishing. `private: true` prevents an
accidental release.

## Product contract

Ship drives Docker Compose from `ship.json`, publishes editable build templates
under `ship/`, and exports portable production releases. Host commands run without
a shell and work toward native Linux, macOS and Windows support. Applications
can use JavaScript or TypeScript; Ship itself is TypeScript compiled to ESM with
declarations. Installing Ship requires no TypeScript runner. Initial host baseline:
Node 22+. No runtime dependencies in the first milestone.

Keep the PHP/Python command vocabulary: `init`, `up`, `down`, `exec`, `shell`,
`logs`, `db`, `config:test`, `doctor`, `build`, `release`, and package-manager
proxies. Production is separate from `up`. No implicit migrations. Adapter boot
hooks and once-per-deploy commands are separate lifecycle stages.

## Configuration

Shared fields retain the existing ecosystem meaning: `services`,
`additionalServices`, `serviceNames`, `externalNetwork`, `processes`,
`deployCommands`, `publishPorts`, and `name`. JavaScript adds `framework`, `node`,
`packageManager`, `scripts`, and `port`. Framework output adds `deployment`,
`serverEntry`, `runtimeFiles` and `angularProject`; infrastructure adds `mongodbMode`.
`scripts` names scripts in `package.json`;
it is not a shell-command injection point. `build: null` means no compilation.
Process/deploy commands can be shell strings or argument arrays.

Unknown fields and invalid selections fail before Docker. Renaming Compose
services updates injected hosts but never changes resource/volume identity.
Named instances prefix variables, e.g. `ANALYTICS_DB_HOST`. Development and
production use distinct Compose project names and data volumes. Overrides apply
only to development. Edited templates survive init unless `--force` is supplied.

The shared, versioned JSON Schema remains an ecosystem task. Do not add a schema
URL until it resolves to a published contract. Current TypeScript contracts are
experimental until the adapter implementation validates their shape.

## Adapter scope

All requested adapters are intended built-ins, not separately installed plugins:

| Key | Initial deployment support |
| --- | --- |
| react | Vite SPA; other tooling through explicit scripts/output settings |
| vue | Vite SPA; other tooling through explicit settings |
| angular | Static and Node SSR; Angular workspace project selection |
| svelte | Standalone Vite SPA |
| nestjs | Node server, TypeScript build, development watch |
| fastify | Node server using project scripts |
| expressjs | Node server using project scripts |
| next | Node standalone and static export |
| nuxt | Node output and static generation |
| sveltekit | Node and static adapters |
| astro | Static and Node output, including server-dependent features |
| vitepress | Generated documentation with correct base paths and 404s |
| tanstack-start | Documented Node deployment target for supported versions |
| gatsby | Static first; SSR/DSG requires separately verified runtime packaging |

Also retain `generic` for arbitrary Node projects. Specific frameworks take
precedence during detection: Next/Start/Gatsby before React, Nuxt/VitePress before
Vue, SvelteKit before Svelte, Nest before its HTTP transport. Explicit selection
wins over detection. Read manifests/configuration as data; do not execute project
configuration on the host merely to detect a framework.

Internally share static, Node and framework-output packaging strategies. Keep
framework selection separate from build-tool detection and deployment mode.
SPA fallback routing differs from generated HTML routing. Framework-specific
output files, writable caches, base paths, WebSockets and HMR belong to adapter
requirements. Unsupported runtime targets fail with an actionable message.

Each supported framework/version/mode needs a fixture proving development HTTP,
reload/HMR, production assets, deep-link routing and source-free release boot.
Document bounded support; do not claim arbitrary historical framework versions.

## Package managers and dependency isolation

Target npm and pnpm, followed by Yarn. Resolve from `packageManager` and lockfiles;
conflicts require a choice. Pin package-manager versions and use frozen production
installs. Package-manager proxies update host manifests/lockfiles from containers.
Never consume host `node_modules` or install application dependencies on the host.
Branch switching must refresh container dependencies. Workspace roots, app paths,
build contexts and runtime dependency packaging need explicit support before
monorepos are accepted. Private registry access must use BuildKit secrets, never
copy credentials into an image.

Current implementation: npm and pnpm, committed authoritative lockfile, exact
`packageManagerVersion`, single application. Init honors matching package.json
`packageManager` version pins (accepting Corepack hash suffix syntax); pnpm
requires a pin. Manager installation uses npm registry integrity verification;
the optional Corepack hash suffix is not independently verified by Ship.
Development installs into a named dependency volume with `npm ci` or a forced,
frozen pnpm install at every app start. Yarn/Bun and workspace files are rejected.
The image user follows host UID/GID on Linux; generated source files should remain
writable. Native Windows/macOS behavior requires CI/Docker verification.

The second milestone implements the shared static/Node strategies and seven
framework adapters: React, Vue, Svelte, VitePress, Express.js, Fastify and NestJS.
Static configuration adds `outputDirectory`, `staticRouting` and `basePath`.
Build and development pass the base path explicitly to Vite/VitePress; production
uses aligned Nginx file placement and routing on port 8080. Static app containers
receive no Ship infrastructure env or env_file, and reject Node workers/deploy
commands. Template metadata detects packaging changes before executing commands.

The third milestone implements all requested framework keys, with bounded modes
documented in [frameworks.md](frameworks.md). Next standalone and Nitro runtimes
copy only their output, while SvelteKit/Astro/Angular include pruned production
dependencies. A generated build helper clears old artifacts and verifies entry
files; explicit runtimeFiles carry extra workers/migrations. Gatsby requires the
generated adapter to report a purely static build. Angular reads production JSON
workspace settings and preserves CSR fallback behavior. No config JavaScript is
executed on the host.

## Process supervision

Node app/worker commands stay in the foreground. For non-TTY commands the
entrypoint creates a POSIX process group, forwards SIGINT/SIGTERM to it and waits
for remaining descendants after the main command exits. Orphans receive SIGTERM
after a main-process crash; remaining group members receive SIGKILL after at most
60 seconds. Docker's stop timeout can end this wait earlier. This covers npm and
shell command chains without allowing a shell's early exit to cut off child cleanup.
Interactive execs retain their controlling terminal rather than creating a new
session. Self-daemonizing processes that leave the group are outside this contract.

Containers use Docker init, a 60-second stop grace period and production
`restart: unless-stopped`. Graceful worker shutdown, crash restart, manual restart
and TTY exec behavior have live Linux coverage. Template format 4 marks the new
entrypoint contract; older templates require review and explicit refresh.

## Infrastructure and MongoDB

Preserve existing service groups and named-instance behavior. First milestone:
PostgreSQL and Redis. The third milestone adds MongoDB in
`database`. MongoDB requires persistent data, authenticated readiness checks,
separate application/admin users, `MONGODB_URI`, `MONGODB_DATABASE`, correct URI
encoding and `mongosh` through `ship db`. Prefer a single-member replica set for
development to support transactions/change streams. Standalone/replica-set mode
must be explicit; a single member provides no redundancy. Production deployments
may use external databases without selecting a local database container.

Never inject database/storage credentials into browser build variables. Static
frontend builds need an explicit public configuration allowlist. Infrastructure
selection does not install application drivers, ORMs or framework integrations.

## Releases

`build` produces local production images. `release --tag TAG` also writes:

```text
dist/ship/TAG/
  docker-compose.yml
  .env
  images/*.tar
  release.json
  README.md
  deploy-commands.sh  # when configured
```

This follows the PHP/Python artifact vocabulary. Every service has an image;
there are no builds or source mounts in the exported Compose file. Workers share
the app image. Export each unique image once and record SHA-256, image tag and
service membership. Publish from a staging directory after all exports succeed;
preserve existing release tags. Secrets live in the private artifact, not build
layers. Production images run unprivileged. Ports are opt-in. Deploy commands
wait for infrastructure and stop on the first failure before app startup.

Before public release: separate public build values, build secrets and runtime
environment, implement Node security-floor policy, verify
runtime-only packaging, add git metadata/immutable image IDs to the manifest,
and test on a second clean Docker host. Multi-architecture output is future work;
portable artifacts initially require compatible host architecture.

## References

- [PHP package](https://github.com/php-ship/ship)
- [Python package](https://github.com/ship-ecosystem/python-ship)
- [npm clean installs](https://docs.npmjs.com/cli/v11/commands/npm-ci/)
- [Compose readiness](https://docs.docker.com/compose/how-tos/startup-order/)
- [Next output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output)
- [Vite static deployment](https://vite.dev/guide/static-deploy.html)
- [TanStack Start hosting](https://tanstack.com/start/latest/docs/framework/react/guide/hosting)
- [MongoDB replication](https://www.mongodb.com/docs/manual/replication/)
- [pnpm frozen installation](https://pnpm.io/cli/install)
- [pnpm script argument forwarding](https://pnpm.io/cli/run)
- [VitePress CLI](https://vitepress.dev/reference/cli)
- [Unprivileged Nginx image](https://github.com/nginx/docker-nginx-unprivileged)
