# Verification

Verified on November 16–17, 2026 with Node 22.23.3, npm 11.20.0,
TypeScript 5.9.3, Docker Engine 29.9.2 and Compose 5.6.1 on Linux.
The granted execution permission enabled Docker, subprocess and socket tests.
The runtime-policy milestone uses an isolated Node 22.23.5 runtime from npm exec;
the globally installed Node 22.23.3 was left unchanged.

## Completed

- Strict type checking, compilation and all 123 unit/integration-boundary tests
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

## GitHub verification

The development repository was created privately at
[ship-ecosystem/js-ship](https://github.com/ship-ecosystem/js-ship). All three
workflows passed on November 17, 2026:

| Workflow | Verified scope | Result |
| --- | --- | --- |
| [Quality and npm packaging](https://github.com/ship-ecosystem/js-ship/actions/runs/44050780342) | Linux/macOS/Windows × Node 22/24/26; 99 unit tests and installed-tarball checks in each of nine jobs | Passed |
| [Docker integration](https://github.com/ship-ecosystem/js-ship/actions/runs/44050780680) | Twelve Linux Docker suites / 27 cases, plus six Chromium browser cases | Passed |
| [Release transfer between runners](https://github.com/ship-ecosystem/js-ship/actions/runs/44049710678) | Export on one runner, checksum verification and source-free boot on another | Passed |

Quality and Docker results above cover code commit `2e2cec7`; release transfer
passed on `536a19b`, before the subsequent VitePress test-fixture-only correction.
The first Docker run exposed a VitePress fixture problem. It now uses the shared
host-owned dependency metadata helper and retains startup diagnostics; the full
corrected matrix passed. Host quality checks on Windows/macOS do not establish
Docker Desktop behavior on those platforms.

The `release-transfer.yml` workflow uses separate producer/consumer runners. Its
standalone verifier is carried in the artifact; the consumer does not check out
this repository or install the SDK. The local transfer check passed after deleting
the producer fixture source and its image tag, then checking the archive checksum,
runtime environment, non-root execution and booting with `--no-build --pull never`.
The local check uses one Docker daemon. The successful GitHub workflow additionally
confirms transfer between separate fresh runner environments, with no source checkout,
SDK/npm installation, image build or registry pull on the consuming runner.

## Build environment milestone (local)

The selected npm package name is now `js-ship`; the GitHub repository remains
`ship-ecosystem/js-ship`. It remains private/unpublished in package metadata.

- Type checking and 102 unit/boundary tests passed, including reserved/public
  variable validation, literal Compose values, secret visibility, no-cache
  argument forwarding and build-context protection against ignore overrides.
- The renamed tarball installed offline and its CLI/public API checks passed.
- npm and pnpm Docker cases exercised registry user configuration in installation
  lifecycle hooks, temporary build-secret environment variables, public-value
  rebuilds, development startup/proxies and production/release isolation. pnpm implicit
  installs before `run`/`exec` are disabled so installs stay within those boundaries.
  Saved builder and exported production image members were scanned for synthetic
  credential markers, decompressing gzip layer blobs where present.
- The existing VitePress static/subpath portable-release case passed, and the
  local source-free release-transfer regression passed.
- Current suite size is 29 Docker cases across thirteen suites. This milestone
  has local Linux results; the GitHub runs linked above cover the earlier code.

These registry tests verify secret configuration delivery and lifecycle isolation;
authenticated private package downloads and credential rotation against actual
registry implementations remain to be added. Build scripts can deliberately
persist any secrets they are allowed to read; no scanner proves arbitrary
application code safe. See [build environment](build-environment.md).

## Configuration schema milestone (local)

- Type checking and all 106 unit/boundary tests passed. AJV compiled the draft-07
  schema in strict mode (with intentional variable-length command tuples enabled).
- Thirty normalized framework/package-manager configurations validated. Tests also
  cover malformed input, traversal rejection, field coverage, local init/refresh
  and preservation of custom editor schema references.
- The installed npm tarball exported `js-ship/schema.json` and `shipConfigSchema`,
  and the installed CLI generated the same offline editor schema. AJV remained a
  development dependency and was absent from the consumer install.
- Nullability is now explicit: non-nullable fields reject `null`; schema references
  must be nonempty strings. These stricter input checks are intentional.
- These are local Linux checks. No additional Docker/browser matrix was run for
  this editor/schema change, and the earlier GitHub run links cover older code.

## Workspace milestone (local)

- Type checking, all 113 unit/boundary tests and installed-tarball verification
  passed. Tests cover package selection, exclusions, containment, root lockfile
  authority, dependency-volume identity, app switching and package-pin consistency.
- npm 12.2.2 and pnpm 12.21.0 Docker fixtures built a shared TypeScript workspace
  package and ran its transitive production dependency after root pruning. No
  compiler packages remained, including pnpm virtual-store copies. Both exported
  releases booted as non-root after removing the original package sources.
- A React/Vite npm workspace passed development serving, shared-package build
  order, production subpath assets and static Nginx packaging without Node.
- Current suite size is 32 Docker cases in fourteen suites. Three workspace cases
  passed locally on Linux. The earlier GitHub run links cover older code; the
  complete framework/browser matrix was not rerun for this milestone.
- Isolated SSR workspace layouts, Gatsby workspace adapter placement, minimal
  dependency closures and broader package-manager/host versions remain unsupported
  or unverified as described in [workspaces](workspaces.md).

## Runtime policy and update milestone (local)

- Type checking, all 115 unit/boundary tests and installed-tarball verification
  passed using patched Node 22.23.5. The existing Node 22.23.3 CLI invocation was
  rejected with a clear upgrade message before project work.
- Node floors are 22.23.5, 24.22.3 and 26.13.1, based on the November 11 upstream
  security releases. Default Node/Nginx/PostgreSQL/Redis/MongoDB parents are pinned
  to registry-resolved multi-platform image digests in a central catalog.
- Generic PostgreSQL/Redis release, VitePress static/subpath release and both
  MongoDB live cases passed using the pinned parents and generated build guards.
- All three catalog Node images ran the generated version guard successfully;
  an overridden Node 22.23.3 base failed before dependency installation. Five live
  Docker cases passed in this milestone. The suite now contains 33 cases across
  fifteen suites; the full framework/browser matrix was not rerun.
- The npm audit reported zero advisories for the current lockfile. This does not
  establish the absence of application or container operating-system vulnerabilities.
- Dependabot and workflow YAML syntax and the catalog's Compose syntax validated.
  The locally prepared Dependabot configuration is not yet activated on GitHub.
  CI now includes generated-artifact checks, a scheduled npm audit and catalog
  change triggers for Docker/release-transfer workflows.
- Private vulnerability reporting must be enabled before the repository's public
  test release. No repository visibility or npm publication action was performed.

## Extension API milestone (local)

- Type checking and all 122 unit/boundary tests passed, covering isolated immutable
  registries, version/collision errors, command/path/result validation, ESM/CJS
  loading, source-change handling, custom schemas, missing-file recovery and
  stable volume/build identity. Class callbacks retain their receiver, and custom
  static defaults select Nginx without implicit Vite build flags.
- A separately installed tarball loaded a module using public SDK imports,
  generated custom templates/schema and passed CLI validation. A consumer's
  TypeScript extension compiled against the public declarations, including
  expected errors for unsupported API versions and mutable registry operations.
- A live Docker custom adapter and build-owned Redis extension passed startup,
  healthchecks, named instances and portable release boot after removing the host
  extension and application source entry. Both instances shared one exported
  infrastructure image; the release recorded extension identity and fingerprint.
- The suite now contains 34 Docker cases in sixteen suites. One extension case
  passed locally; the full GitHub/framework/browser matrix has not been rerun for
  these accumulated local changes. The repository remains private/unpublished.

## Remaining verification

Additional versions/package managers and framework options,
browser HMR beyond the Vite cases above, Windows/macOS Docker behavior,
and security/release review remain before public beta. Successful
representative builds do not establish support for every framework version.

## Accumulated-change review

Before the full GitHub rerun, local review closed four validation gaps: managed
host/port environment names are reserved, Compose-escaped public expressions are
not treated as production credential requirements, newline-suffixed package-manager
pins/release tags are rejected, and explicitly disabled service healthchecks use
startup dependencies. All 123 unit/boundary tests and installed-package/type checks
passed under Node 22.23.5.

The first remote run exposed cached Node patches below the reviewed floors.
All setup-node steps now request the latest patch. At revision `35c4aa5`, all
34 Docker cases across sixteen suites and all six Chromium cases passed in
[Docker CI](https://github.com/ship-ecosystem/js-ship/actions/runs/44113006991).
The [cross-runner release transfer](https://github.com/ship-ecosystem/js-ship/actions/runs/44113007064)
also passed. Linux and Windows checks passed across Node 22/24/26; macOS Node 26
passed before a subsequent catalog fix superseded that quality run.

The activated image updater exposed a native editing failure with the JSON-syntax
Compose catalog. Revision `e8eb8d3` switches it to `images/Dockerfile`, preserving
every image reference and generated runtime policy. MongoDB minor-family updates
are now excluded alongside the existing major-version exclusions. Local checks
and the installed 107-file tarball passed again. The fresh
[cross-runner release transfer](https://github.com/ship-ecosystem/js-ship/actions/runs/44116254112)
passed. The [native image updater](https://github.com/ship-ecosystem/js-ship/actions/runs/44116268664)
completed successfully, reading all catalog images and retaining MongoDB 8.0.
Linux and Windows quality/package checks passed across all three Node majors,
and npm audit passed. All 34 Docker cases and six Chromium cases passed again in
[Docker CI](https://github.com/ship-ecosystem/js-ship/actions/runs/44116254253).
After repeated unassigned macOS runner queues, quality CI now uses GitHub's
explicit supported `macos-15` baseline rather than the rolling `macos-latest`
label. The final [quality matrix](https://github.com/ship-ecosystem/js-ship/actions/runs/44117566770)
passed on Linux, macOS 15 and Windows across Node 22/24/26, including installed
package and declaration checks, generated-artifact checks and the audit job.
Windows explicitly skips the existing symlink boundary case; Linux/macOS run it.
The repository remains private and npm publication has not occurred.

## npm prerelease preparation

- Added an Unreleased changelog, explicit public-registry/`next` metadata and a
  documented ownership/bootstrap and trusted-publisher setup path. The manifest
  remains private at `0.1.0-dev.0`; no npm credentials or publishing settings have
  been changed.
- All 126 local unit/boundary tests passed under Node 22.23.5, including rejection
  of private/mismatched repository identities, wrong tags, development/stable or
  malformed versions, inconsistent lock metadata and missing release notes.
- Offline preview passed; publish preflight rejected the current private manifest.
  Installed CLI/API/declaration checks passed for the 109-file tarball. The exact
  tested tarball can now be retained, and package inspection checks allowed roots,
  credential-file paths and changelog inclusion before installation.
- Workflow/Dependabot YAML parsed locally. The new workflow's preview has read-only
  permissions; its separately dispatched publication job uses OIDC and the tested
  tarball without rebuilding. Both the [push preview](https://github.com/ship-ecosystem/js-ship/actions/runs/44126950020)
  and [manual preview with publish=false](https://github.com/ship-ecosystem/js-ship/actions/runs/44127093489)
  passed and skipped publication; the npm-package artifact was uploaded.
  Real OIDC authorization, registry installation and provenance remain unverified
  until a future authorized public release.
- The [quality matrix](https://github.com/ship-ecosystem/js-ship/actions/runs/44126950743)
  passed across Linux/macOS 15/Windows and Node 22/24/26, along with the npm audit.
  The [cross-runner transfer](https://github.com/ship-ecosystem/js-ship/actions/runs/44126950172)
  passed. All 34 Docker cases across sixteen suites and all six Chromium cases
  passed again in [Docker/browser CI](https://github.com/ship-ecosystem/js-ship/actions/runs/44126950235).
  These runs verified code revision `1c2dd1a`; the final follow-up only records
  these results. The repository remains private and npm remains unpublished.
- A read-only public registry lookup on November 17 returned E404 for `js-ship`.
  This does not reserve the name or establish account publishing rights.

## Failure recovery milestone

- Three lifecycle cases passed, including the new shell/npm process-tree case
  with 12-second app/child shutdown handlers. The slow case uses the generated
  Compose grace period without a shorter CLI timeout, verifies drain completion
  and retains crash/manual-restart and controlling-terminal coverage.
- Three MongoDB cases passed across focused runs. The new replica-set recovery
  case blocks app startup with an unhealthy dependency, verifies an automatic
  restart after killing mongod inside the fixture, confirms persisted records and
  a new transaction, and checks that a manual stop remains stopped.
- The recovery fixture also changes the root environment credential without
  changing the persisted user. Startup fails, health output omits the credentials,
  and the existing app user still authenticates. Restoring the original setting
  restores healthy startup with the same data/configuration volumes and key hash.
  Users are fully initialized before readiness faults are injected; interrupted
  first-time initialization and application-driver reconnects are not covered.
- All 126 unit/boundary checks and the installed 110-file tarball passed under
  Node 22.23.5. Runtime implementation/templates did not change. The Docker suite
  now contains 36 cases across sixteen suites.
- The [quality matrix](https://github.com/ship-ecosystem/js-ship/actions/runs/44131608770)
  passed on Linux/macOS 15/Windows across Node 22/24/26, including package and
  declaration checks and npm audit. The MongoDB and lifecycle jobs passed in
  [Docker CI](https://github.com/ship-ecosystem/js-ship/actions/runs/44131608698);
  all 36 Docker cases passed. The separate browser job passed five cases but
  failed React's initial subpath load. Its retained trace showed
  `net::ERR_NETWORK_CHANGED` on the React refresh preamble, followed by the React
  plugin's missing-preamble error. Browser files were creating/removing Docker
  networks concurrently; they now run sequentially to avoid overlapping network
  setup with a different fixture's active browser. Verification of this harness
  change passed all four HMR cases on the next runner, but Next's final 404
  navigation still hit `ERR_NETWORK_CHANGED`. Sequencing alone was insufficient.
  The ephemeral browser CI runner now disables IPv6 on newly created interfaces
  before starting fixtures, avoiding Docker veth link-local address notifications
  during IPv4 loopback requests. This CI-only setup follows the same failure mode
  documented in [Ghost's browser tests](https://github.com/TryGhost/Ghost/blob/main/e2e/README.md#sign-in-page-never-renders-on-linux).
  Browser assertions and retry behavior are unchanged. IPv6 coverage is not
  established by these fixtures. Verification of this runner setup is pending.
- Added [startup, shutdown and recovery](recovery.md) with operational steps and
  the remaining scope: disk/host/daemon failure, backup restoration, other database
  recovery, version upgrades and Docker behavior beyond Linux.
