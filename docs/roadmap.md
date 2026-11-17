# Roadmap

## First milestone: executable Node foundation

Implemented, with local verification recorded in the README:

- Compiled TypeScript CLI and declaration exports; no runtime dependencies.
- Generic Node adapter and npm lockfile workflow.
- Strict configuration, service contexts and named Postgres/Redis instances.
- Development/production Compose generation, overrides and service renaming.
- Development dependency isolation and startup refresh.
- Worker processes sharing the production app image.
- CLI proxies, terminal-aware execution, container and HTTP readiness checks.
- Production credential checks and multi-stage production builds.
- Staged release assembly, image deduplication, archive checksums, deploy commands.
- Example app, unit/integration-boundary tests, opt-in live Docker workflow test.

Generic development/database/release workflows have passed live Docker checks.

## Second milestone: package managers and shared deployment strategies

Implemented with planning/template and release-boundary tests:

- npm/pnpm abstraction, exact version pins, lockfile and manifest conflict checks.
- Package-manager proxies and package-specific script argument forwarding.
- Node packaging with production dependency pruning.
- Static runtime with unprivileged Nginx, subpaths, SPA fallback, generated HTML
  routing, real missing-asset 404s and no infrastructure env injection into app.
- React, Vue, Svelte (Vite projects), VitePress, Express.js, Fastify and NestJS.
- Specific framework detection, explicit overrides and unsupported-mode errors.
- Template metadata and stale-packaging checks preserving custom edits.
- Live VitePress subpath/source-free-release smoke test passed.
- npm/pnpm source reload and branch-switch dependency-refresh regressions passed.
- Live Vite React/Vue/Svelte component builds, subpath assets and SPA routes passed.
- Live Express/Fastify/NestJS development and production HTTP passed, including
  runtime values and NestJS TypeScript compiler pruning.

## Third milestone: framework output and MongoDB

Implemented with planning, output-file and bootstrap tests:

- Next.js standalone/static, Nuxt Node/generate, SvelteKit Node/static, Astro
  static/standalone Node, Angular modern static/SSR, TanStack Start Nitro/Vite Node.
- Gatsby static adapter using its public build API; server/function/redirect
  targets fail rather than producing a partial static release.
- Fresh build-output checks, isolated framework runtimes, production dependency
  copying, explicit worker/migration runtimeFiles and Angular CSR fallback handling.
- Authenticated MongoDB standalone/single-member replica sets, readWrite app users,
  URI encoding, named instances, stable data/key volumes and mongosh.
- Builds/exports deduplicate both app and owned MongoDB images.
- App/worker/deploy/proxy entrypoints construct MongoDB URIs without forwarding
  the administrator password into app children.
- Live Next.js standalone build/SSR/assets/source-free release passed.
- Live Next.js static exports passed both trailing-slash layouts, portable Nginx
  releases, nested routes, browser hydration and client navigation.
- Live Astro, SvelteKit and Nuxt Node/static builds and HTTP/public assets passed;
  Nuxt uses an explicit npm 11 pin. Astro development/build subpaths now agree.
- Live Angular Node/static and TanStack Start React/Nitro builds passed.
  Angular development authorizes loopback SSR requests while production retains
  the application's hostname policy.
- Live Gatsby static output/assets/security headers passed; an actual SSR page
  is rejected. Built-in Gatsby header rules are accepted with conservative caching.
- MongoDB live transactions, change streams, rename persistence, portable release
  and standalone authentication/restart persistence passed.
- Chromium verifies React/Vue/Svelte component and CSS HMR through actual published
  ports, preserving an unchanged parent's state and document across edits.
- Worker argv/shell crash and manual restarts, graceful child/app shutdown and
  interactive TTY execs passed. Template format 4 supervises process groups.
- GitHub host quality/installed-package checks passed on Linux/macOS/Windows
  across Node 22/24/26. All twelve Docker suite jobs and six Chromium cases passed.
- A fixture release was exported on one GitHub runner and booted on another
  without application sources, SDK installation, a build or registry pulls.

## Next: runtime verification and usability

- Extend version/package-manager/framework-option coverage beyond the representative
  live builds now available for all fourteen frameworks and Next.js export layouts.
- Yarn support.
- Extend browser HMR coverage beyond Vite React/Vue/Svelte and add other browsers.
- Broader subpath support, additional build tools and framework version matrices.
- Gatsby SSR/DSG would require a separate runtime strategy.
- Interactive init and fully equivalent non-interactive options.

## Infrastructure

- MySQL, Mailpit, Meilisearch.
- Garage, SeaweedFS, RustFS, Silo, browser-test services.
- External database documentation and public/client environment boundaries.
- Extend MongoDB coverage to version upgrades and explicit failure recovery.

## Public testing approach

Complete the remaining package work first, then make the GitHub repository public
and publish a clearly marked npm prerelease for public testing. Authenticated
private-registry download verification is deferred; do not block this work on it.
The development repository remains private and the npm package remains unpublished.

## Before public beta

- Broaden runtime checks to longer shutdowns, infrastructure failures and host/platform variants.
- Build environment separation and npm/pnpm registry secret mounting implemented;
  extend authenticated private-registry download coverage.
- Reviewed Node floors, digest-pinned parent catalog, Dependabot configuration,
  generated-artifact checks and scheduled npm audit implemented. Dependabot is
  active on GitHub, including a successful native image-catalog update check.
  Enable private vulnerability reporting before public testing.
- Shared JSON Schema, offline editor integration and npm schema export implemented.
- Extension API v1 implemented: explicit local JS/CJS modules, isolated validated
  registries, owned volumes, namespaced templates and project-specific schemas.
- Root npm/pnpm workspace installs, explicit app/build order, isolated development
  dependency volumes and layout-preserving Node/static packaging implemented.
  Dedicated isolated-SSR workspace layouts and minimal dependency closures remain.
- Changelog, npm metadata checks and a preview/explicit-prerelease publishing
  workflow prepared; it retains the installed-package-tested artifact and uses
  OIDC for publication. npm ownership bootstrap, the GitHub `npm` environment
  and the package trusted-publisher settings remain account-side release steps.
  See [npm release preparation](npm-release.md). The name remains `js-ship`.
- Optional Mutagen integration and richer doctor recovery hints.

Current local results and their limits are recorded in [verification](verification.md).
