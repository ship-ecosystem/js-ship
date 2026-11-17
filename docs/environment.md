# Development, build, runtime and browser environment

Ship separates container startup values from public build input and temporary
build credentials. Your application/framework still controls how it reads values
and what it renders or bundles for the browser.

## Choose the phase

| Input | Where Ship makes it available | Release behavior |
| --- | --- | --- |
| `.env` | Development app containers for Node deployment strategies via `env_file`; also development Compose interpolation | Not selected as the production environment |
| `.env.production` | Production Node app/worker containers via `env_file`; production Compose interpolation | Always copied to the release directory as private `.env` |
| `build.publicEnv` | Development container environment and production application build arguments | Public values can persist in generated output/image layers; baked browser values require a rebuild to change |
| `.ship-secrets/NAME` selected by `build.secrets` | Production build command's temporary BuildKit environment | Not automatically copied or mounted at runtime |
| `.ship-secrets/npmrc` selected by `build.npmrc` | Selected dependency install/prune/proxy steps | No production runtime registry mount |
| Exported release `.env` | Release Compose interpolation and Node app/worker `env_file` | Private deployment artifact, including external connection credentials |

`ship release` requires `.env.production`, including for an external-only or static
project. Static production containers receive no generated env file or application
environment, but their release directory still contains the copied `.env`. For a
static-only app, keep that file free of unused server credentials. The archive
folder is private even when its web assets are public.

Provide a separate runtime entry when a Node server also needs a public build
value at startup; `build.publicEnv` supplies build steps and development containers.
For static deployment strategies, the generated development service also has no
`env_file` entry; framework code can still load files from the source bind mount.

Ship's production build context excludes `.env`/`.env.*` files at every depth,
including `.env.example`, and excludes registry/secret files. Production builds do
not receive `.env.production` as application build environment. A build that needs
a CMS credential should use an explicit build secret; the build must not embed
it into browser output. See [build credentials and caching](build-environment.md).

Development uses a source bind mount. Framework dotenv loading, install hooks and
other trusted project code can read files in that checkout, including environment
files. Build-context exclusions are not a sandbox for development code. Ship does
not promise framework dotenv files have identical meaning across development,
Docker build and Node runtime.

## Precedence and changes

An environment file is not the same as exporting variables in the host shell.
Ship's generated `env_file` entries inject values into Node containers. Host
variables influence Compose substitutions where the generated model contains
`${...}` (for example managed service credentials); exporting an arbitrary
`DATABASE_URL` on the host does not automatically inject it into the app.

Generated Compose `environment` entries override matching `env_file` entries,
including managed `HOST`, `PORT`, `NODE_ENV`, service connection fields and public
development values. The Node entrypoint can then derive managed MongoDB URIs
from `MONGODB_HOST` fields. Application/framework configuration may apply its own
rules afterwards. See [external connections](external-services.md) and Docker's
[environment precedence](https://docs.docker.com/compose/how-tos/environment-variables/envvars-precedence/).

Use single-quoted literal URLs in env files, percent-encoding credential components
when constructing them. Compose interpolation applies to unquoted/double-quoted
values; see [Docker interpolation](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/).
Keep resolved Compose output and credential-bearing driver errors private.

Editing a file does not change an already running container's environment.
Development `ship up` explicitly recreates the app and repeats its frozen install.
For a deployed release, update its private `.env` and recreate affected Node app/
worker containers with the release's Compose configuration. Changing runtime
server credentials normally needs recreation, not an application rebuild. Changing
compiled public/browser values needs a new build/release. Build-secret contents
do not automatically invalidate Docker cache; use the documented cache controls.

## Browser-visible configuration

Treat every `build.publicEnv` value as public, regardless of its name. Ship does
not infer a variable's intended audience from its value. A database password,
private connection URI or server token belongs in server-only application
configuration or an appropriate build secret, never in public build input.

| Framework/tooling | Relevant boundary |
| --- | --- |
| [Vite](https://vite.dev/guide/env-and-mode) (React/Vue/Svelte/VitePress tooling) | Default `VITE_` values are client-visible and replaced during builds. Custom prefixes/application code can expose other values. |
| [Next.js](https://nextjs.org/docs/app/guides/environment-variables) | `NEXT_PUBLIC_` values are inlined at build time; changing a container env file does not update those browser bundles. Server runtime reads depend on the application's rendering path. |
| [Nuxt](https://nuxt.com/docs/4.x/guide/going-further/runtime-config) | `runtimeConfig.public` is client-visible. Matching `NUXT_` overrides apply to configured runtime keys on a running server; a static generated site has no Node server to apply runtime overrides. |
| [SvelteKit](https://svelte.dev/docs/kit/environment-variables) | Use the installed version's explicit server/client environment declarations. SvelteKit 3 deprecates the legacy `$env/static/public` module; a generic prefix rule is not its complete environment contract. |
| [Astro](https://docs.astro.build/en/guides/environment-variables/) | Its Vite-style `PUBLIC_` imports are client-visible build values; explicit `astro:env` schemas have their own server/client rules. |
| [Gatsby](https://www.gatsbyjs.com/docs/how-to/local-development/environment-variables/) | `GATSBY_` values are exposed when the site JavaScript is compiled. |

These are framework rules, not a promise that Ship rewrites an application to use
them. Other adapters and custom build tools need application-specific configuration.
A value supplied only at Node startup is too late for prerendering/static builds
that read it during compilation. Server-only rendering code can still leak values
by returning them in HTML, JSON, logs or other responses.

Known public prefixes are rejected for build-secret names. An explicit client/public
declaration or custom build code can expose a differently named secret; keep its
application declaration server-only.

## Practical configurations

For a backend using external providers, select no managed services and put the
application's connection URLs in `.env`/`.env.production`. The
[repository example](https://github.com/ship-ecosystem/js-ship/tree/main/examples/external-services)
shows an explicit connection-check command. No provider URL is needed in
`build.publicEnv` for that example.

For a Vite frontend calling that backend, public build configuration can contain:

```json
{
  "build": {
    "publicEnv": { "VITE_API_URL": "https://api.example.invalid" }
  }
}
```

That URL identifies an API intended for browser access; keep database access and
credentials on the backend. Renaming a secret with a public prefix does not make
it suitable for browser delivery.
