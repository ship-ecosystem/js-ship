# Changelog

No npm versions have been published. Entries below describe the first planned
public prerelease; they are not a stable compatibility promise.

## Unreleased

- TypeScript ESM CLI and public extension API with no runtime dependencies.
- Development environments and portable Docker releases for generic Node apps,
  React, Vue, Angular, Svelte, NestJS, Fastify, Express, Next.js, Nuxt, SvelteKit,
  Astro, VitePress, TanStack Start and Gatsby, within the documented deployment modes.
- Pinned npm/pnpm/Yarn 4 node_modules installs, explicit workspace selection and
  ordered shared builds, including isolated Next.js standalone/Nuxt Node workspace
  runtimes.
- PostgreSQL, Redis and authenticated MongoDB, including named instances and a
  single-member replica-set option for transactions and change streams.
- Production workers, process supervision, health checks, CLI proxies and portable
  image archives that can boot without application sources or the Ship SDK.
- Interactive initialization with equivalent automation flags, plus development
  doctor diagnostics, effective override/project checks, remote endpoint guidance,
  recovery hints and JSON output.
- Separate public build variables, BuildKit secrets and private registry settings.
- External database and environment guides, with an application-owned connection
  probe example for PostgreSQL, Redis and MongoDB.
- Offline JSON Schema, editor integration and validated local extension modules.
- Reviewed Node version floors, digest-pinned parent images and dependency updates.

See [framework modes](docs/frameworks.md), [workspaces](docs/workspaces.md) and
[verification](docs/verification.md) for supported configurations and tested limits.
Bun, Yarn Plug'n'Play/older majors, Gatsby SSR/DSG and the other isolated-SSR
workspace layouts are not yet implemented. Container builds currently have representative Linux coverage;
Linux/macOS/Windows quality checks cover the host CLI and installed npm package.
