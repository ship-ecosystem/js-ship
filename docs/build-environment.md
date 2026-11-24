# Build variables, secrets and private dependencies

Ship keeps production runtime values in `.env.production`. That file is injected
when Node containers start and copied into the private release directory as `.env`;
it is not sent to the image build. Static production images receive no runtime
environment file. Public frontend values must be supplied explicitly at build time.

See [environment boundaries](environment.md) for development, runtime, public
framework configuration and release-file behavior, and [external services](external-services.md)
for application-owned database URLs.

## Configuration

Add this section to `ship.json`:

```json
{
  "build": {
    "publicEnv": {
      "VITE_API_URL": "https://api.example.com"
    },
    "secrets": ["CMS_TOKEN"],
    "npmrc": true
  }
}
```

All fields are optional. The default is no public variables, no build secrets and
no registry configuration. These fields do not read values implicitly from the
host environment or `.env.production`.

`publicEnv` maps uppercase environment names to literal strings. Values are
available to production build commands and development containers. Use your
framework's public prefix, for example `VITE_`, `NEXT_PUBLIC_`, `NUXT_PUBLIC_`,
`PUBLIC_` or `GATSBY_`, where appropriate. Angular/application-specific build scripts
can consume explicitly named variables too. Treat every value here as public:
it can appear in generated Compose files, image metadata, build cache and browser
bundles. Dollar signs are literals, not Compose interpolation. Ship and package
manager control variables such as `PATH`, `NODE_OPTIONS` and `NPM_CONFIG_USERCONFIG`,
plus managed runtime binding variables (`HOST`, `HOSTNAME`, `PORT`, `NG_ALLOWED_HOSTS`),
are reserved.

Put each named secret in `.ship-secrets/NAME`, for example
`.ship-secrets/CMS_TOKEN`. BuildKit exposes its contents as an environment variable
only while running the production build script. Ship does not forward these
variables to dependency installation, pruning, development startup or production
runtime. Missing secret files fail before Docker runs. Use `.env` for development
application credentials when needed.

## Private npm and pnpm dependencies

The registry-secret workflow below supports npm/pnpm; Yarn registry
authentication is not implemented (see [Yarn scope](yarn.md)).

With `npmrc: true`, put a complete npm configuration in `.ship-secrets/npmrc`:

```ini
@your-team:registry=https://registry.npmjs.org/
//registry.npmjs.org/:_authToken=YOUR_READ_ONLY_TOKEN
```

Use the appropriate registry URL and a credential restricted to reading packages.
The secret file must be self-contained; Ship does not resolve host variables such
as `${NPM_TOKEN}` inside it. Keep the lockfile committed, with tarball URLs pointing
to the registry that serves the dependencies. A project-root `.npmrc` is excluded
from builds; move required install settings into this secret configuration.

Ship temporarily sets `NPM_CONFIG_USERCONFIG` to the mounted file during the
production dependency install/prune and development startup install. `ship npm`
and `ship pnpm` proxies also use it. Application startup does not inherit this
setting. Ship disables pnpm automatic installs before `run`/`exec`; dependency
changes go through the explicit install steps or package-manager proxies.
The development container can access the mounted registry file and the
source checkout; run only trusted project code. Production containers receive no
registry secret mount.

## Cache and release boundaries

Public variable declarations belong to the builder stage, after dependency
installation. Changing a public value rebuilds the application; adding or removing
variable names or secret settings changes the templates. Review custom edits and
run `ship init --force` to refresh them before building with new settings.

Secret contents are not Docker build arguments or persistent image environment
variables. BuildKit secret changes do **not** invalidate cached steps. If a changed
CMS response or registry credential requires a fresh install/build, invalidate the
relevant cache explicitly, for example:

```sh
ship build --no-cache
```

This rebuilds project-owned images without using cached build steps. Configure
shared caches and cache exports in your Docker builder or CI.

`ship init` adds `.ship-secrets/` and `.npmrc` to Git ignore rules. Build-context
rules exclude `.ship-secrets` and `.npmrc`/`.env` files at every depth,
including example environment files. Ship refuses builds if those exclusions are
missing, followed by negation rules, or overridden by `ship/Dockerfile.dockerignore`.
Do not commit credential files already tracked by Git; ignore rules do not untrack
existing files.

Release Compose files contain no build-secret definitions or references. Build
secret files are not copied into release directories. The runtime `.env` is still
included intentionally and the release directory must remain private. Keep build
credentials out of `.env.production` if they must not be exported.

Build and install scripts are trusted code: they can read the secrets granted to
their step and could print or write those contents. Secret mounts prevent automatic
persistence, not deliberate embedding by application code. A public framework
prefix can also cause a secret to be bundled into client code; do not use those
names for build secrets; known public prefixes are rejected.

The mounting and cache behavior follow [Docker build secrets](https://docs.docker.com/build/building/secrets/)
and the [Compose build specification](https://docs.docker.com/reference/compose-file/build/#secrets).
