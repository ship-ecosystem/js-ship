# Local verification

Verified on November 16–17, 2026 with Node 22.23.3, npm 11.20.0,
TypeScript 5.9.3, Docker Engine 29.9.2 and Compose 5.6.1 on Linux.
The granted execution permission enabled Docker, subprocess and socket tests.

## Completed

- Strict type checking, compilation and all 99 unit/integration-boundary tests
  passed, with no skips. These include subprocess forwarding, CLI integration
  and HTTP readiness.
- `npm run test:package` built and installed the npm tarball offline into a
  separate consumer. The installed CLI initialized and validated MongoDB and
  Gatsby projects; the packaged Gatsby helper accepted built-in header rules.
  Its public ESM API exposed all 15 adapter keys without source or dev dependencies.
- All 80 development/production Compose models across 40 framework/mode/manager
  cases passed `docker compose config --quiet`. Each includes two named MongoDB
  instances. Shell syntax checks passed for 120 generated scripts.

## Live Docker coverage

On November 16, `npm run test:docker` passed the original seven cases across five
suites with no skips (251 seconds). At most two suite files run concurrently.
Fixtures use unique stack names and clean up
only their own containers, volumes and application image tags. Base images and
build cache may remain. The cases cover:

- Generic Node development, PostgreSQL/Redis, database and npm proxies, and a
  copied production release that boots after its original source is removed.
- npm and pnpm source reload and dependency refresh after restoring an older
  manifest/lockfile, simulating a branch switch. This caught a stale dependency
  bug: every explicit development `ship up` now recreates the app and reruns its
  frozen install. Infrastructure retains normal Compose change detection.
- VitePress 1.6.4 development modules and production HTML/assets under a subpath,
  genuine missing-page/asset 404s, Nginx configuration and a static runtime without
  Node. The release runs without its original source.
- Next.js 16.4.6 with React 19.3.1: development SSR, a real standalone build,
  production SSR/static/public assets, unprivileged execution and a copied release
  after removing the original app/public source.
- MongoDB replica-set initialization, real transactions and change streams,
  encoded credentials, app/admin privilege separation, service rename/data
  persistence, shared-image export and a source-free release with named instances.
- MongoDB standalone authentication, writes and persistence through down/up,
  with a standalone connection URI.

On November 17, twelve additional cases passed across `vite`, `servers` and `ssr`
in focused runs, including reruns after the Astro fix and Nuxt fixture pin change:

| Adapter | Pinned version | Live checks |
| --- | --- | --- |
| React | 19.3.1, Vite 8.3.8 | Dev module compilation, component bundle, subpath assets, SPA fallback |
| Vue | 3.5.45, Vite 8.3.8 | Dev module compilation, component bundle, subpath assets, SPA fallback |
| Svelte | 5.57.3, Vite 8.3.8 | Dev module compilation, component bundle, subpath assets, SPA fallback |
| Express | 5.3.0 | Dev HTTP, production routes and request/runtime values |
| Fastify | 5.12.8 | Dev HTTP, production routes and request/runtime values |
| NestJS | 12.5.1 | TypeScript build, production routes and request/runtime values, compiler pruning |
| Astro | 7.4.12, Node adapter 11.1.13 | Node SSR/request/runtime values and static HTML/public assets; static `/guide/` alignment |
| SvelteKit | 3.2.0, Node adapter 6.0.2, static adapter 4.0.1 | Both adapter builds, SSR/request/runtime values, prerendered HTML/public assets |
| Nuxt | 4.6.4, npm 11.20.0 | Nitro Node SSR/request/runtime values and `nuxt generate` HTML/public assets |

The Astro subpath fixture exposed a missing development `--base` argument. Ship
now passes the same configured base to development and static build commands;
both the regression test and a live `/guide/` build/start check passed.

Fixtures use npm 12.2.2 except Nuxt, which explicitly selects npm 11.20.0.
The initial Nuxt/npm 12 install failed with `EALLOWREMOTE` on the bundled
`@parcel/watcher-wasm` 2.6.0 registry tarball before app startup. The npm 11 fixture
pin exercises the existing version-selection contract without changing install
permission defaults. Nuxt with this dependency graph remains unverified on npm 12.

These fixtures build production images, remove host source files and start with
`--no-build`. Production models have no source bind mounts. Static images serve
public assets, return 404 for missing scripts and have no Node runtime; Node
images run as an unprivileged user. These image checks supplement the original
portable archive release tests; they do not export an archive for every fixture.

Further checks on November 17 passed for Angular 22.2.6 (CLI/build/SSR 22.2.7,
TypeScript 6.0.3) in Node and static modes, with custom browser/server output
directories, built/public assets and production dependency pruning. The SSR
fixture explicitly configures production loopback hosts and confirms an
unauthorized Host header still receives HTTP 400. Ship now authorizes only
localhost/127.0.0.1 by default in Angular development, with an environment override;
production retains the application's host policy.

TanStack Start React 1.169.5 / Router 1.170.46 with Nitro 3.0.261103-rc passed
development, Node production SSR, request/runtime-value endpoints and built/public
assets without host sources. This covers its Vite/Nitro shape, not Rsbuild or Solid.

Gatsby 5.16.1 / React 18.3.1 passed development, static HTML/scripts/public assets,
source-free image startup without Node, built-in security headers and a real
SSR-page build rejected by Ship's adapter. The fixture uses a CommonJS root, ESM
Gatsby config and npm 12's explicit installer approval for `sharp@0.32.6`.
The live build exposed that Gatsby always supplies built-in header rules; Ship
now accepts those rules, preserves the security headers and uses conservative
cache revalidation. Custom header changes, redirects, wildcard routes, functions
and SSR/DSG remain rejected. Older Gatsby templates require an explicit refresh.

These four additional cases passed in focused runs, bringing the live suite to
23 cases across 11 suite files. All fourteen requested frameworks now have at
least one representative real build/runtime check. The container fixtures used
Node 24.22.3; the CLI host ran Node 22.23.3. Captured process errors now retain
stdout and stderr so build rejection diagnostics can be checked precisely.

The lifecycle suite adds two live cases for direct argv and shell worker commands.
Both verify crash restart, manual stop/start, unprivileged execution, child-process
drain, npm-started app shutdown and interactive exec access to `/dev/tty`.
It first reproduced forced termination/lost signals with the old entrypoint.
The process-group supervisor fixes these paths; format-3 templates must be
explicitly refreshed to format 4. These cases bring the Docker suite to 25 cases
across 12 files. A real Next.js standalone build, source-free release, HTTP/assets
and non-root runtime also passed again after the supervisor change (128 seconds).

Next.js 16.4.6 static exports now pass both `trailingSlash` layouts as copied,
checksum-verified Nginx releases, with nested generated routes, CSS/JS/public assets,
custom 404s and no Node runtime or host source mounts. Browser checks also pass
hydration and Link navigation across exported routes, preserving shared layout state
and the original document. These tests exposed a directory-index 403 in the default
layout; the Next-specific routing fix and template-refresh guard address it. The
Docker suite now contains 27 cases; there are six browser cases in total.

## Browser HMR coverage

Four additional Chromium cases passed for React at `/` and `/lab/`, Vue at
`/lab/` and Svelte at `/lab/`, using the Vite/framework pins above, Playwright
1.65.1 and system Chromium 155.0.8059.84 on Linux. The browser connects to the
actual ephemeral published localhost port, checks live WebSocket update frames,
edits a child component and CSS, and retains both the document token and a counter
in the unchanged parent. These checks verify actual browser updates rather than
only fetching changed modules. Edited-component state preservation, other framework
HMR paths, Firefox/WebKit and Windows/macOS browser/Docker combinations remain
unverified. Traces and screenshots are saved on failures.

Two more Chromium cases cover the Next static-export layouts described above.

The framework matrix unit tests use manifest/lockfile and output fixtures. They
verify adapter selection, command planning, output layouts, secrets, routing and
refresh behavior; they do not install every framework. Unit release tests use
an image-export runner and archive fixture bytes. The live cases above provide
actual build/start evidence for their specific configurations only.

## Repeatable checks

```sh
npm ci
npm run check
npm run test:package
npm run test:docker
npx playwright install chromium
npm run test:browser
npm run test:transfer
```

GitHub workflows are prepared in `.github/workflows/`: quality and installed
packaging checks across Linux/macOS/Windows with Node 22/24/26, plus twelve Linux
Docker suite jobs and a separate Chromium HMR job. Workflow YAML has been parsed locally; these jobs have not
been executed on GitHub yet.

The `release-transfer.yml` workflow uses separate producer/consumer runners. Its
standalone verifier is carried in the artifact; the consumer does not check out
this repository or install the SDK. The local transfer check passed after deleting
the producer fixture source and its image tag, then checking the archive checksum,
runtime environment, non-root execution and booting with `--no-build --pull never`.
This local check uses the same Docker daemon; the separate-host claim still needs
the GitHub workflow result.

## Remaining verification

Additional versions/package managers and framework options,
browser HMR beyond the Vite cases above, Windows/macOS Docker behavior,
a second clean
Docker host, and security/release review remain before public beta. Successful
representative builds do not establish support for every framework version.
