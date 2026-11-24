# Yarn 4 with node_modules

Ship supports exact stable Yarn 4 pins using the `node-modules` linker. Keep
`yarn.lock` as the single authoritative lockfile and declare the version in the
root `package.json`:

```json
{
  "packageManager": "yarn@4.18.1"
}
```

Commit a root `.yarnrc.yml` with this explicit top-level line (a quoted value and
an inline comment are also accepted):

```yaml
nodeLinker: node-modules
```

Create and commit the lockfile with that Yarn version before initialization. For
an existing npm/pnpm project, migrate its dependencies and remove the former
manager's lockfile deliberately; Ship does not convert lockfiles or run a host
install for you. Stop an existing Ship stack before changing package managers,
then review generated-file edits before refreshing templates.

```sh
ship init --no-interaction
ship up
ship yarn add --exact YOUR_DEPENDENCY
```

Without a manifest pin, both `--package-manager yarn` and
`--package-manager-version 4.18.1` are required. An existing manifest declaration
must agree with `ship.json`. Classic Yarn, Yarn 2/3, future major versions, Bun,
and Plug'n'Play artifacts are rejected. Ship requires the simple top-level
`nodeLinker` spelling above; Yarn validates the rest of the YAML during execution.

## Container behavior

Ship installs the pinned `@yarnpkg/cli-dist` distribution through npm inside the
image, disabling preinstalled Corepack shims and replacing the base image's Yarn
binaries. It does not depend on a host Yarn install or fetch a floating version.
As with npm/pnpm pins, an optional Corepack hash suffix is accepted as metadata;
Ship does not independently verify that suffix.

Development startup and production dependency installation use
`yarn install --immutable`, so stale manifest/lockfile pairs fail instead of
updating the lockfile implicitly. Explicit `ship yarn add`/`remove` commands can
update the bound manifest and lockfile. Script arguments are forwarded directly
without npm's extra `--` separator.

Generated containers enforce `YARN_NODE_LINKER=node-modules` and
`YARN_IGNORE_PATH=true`: the configured pin remains authoritative even when the
checkout has a `yarnPath`. Container caches use Yarn's global cache instead of a
checkout cache, and install state lives in the isolated root dependency volume.
Host `node_modules`, Yarn cache/unplugged directories and install state are
excluded from generated production build contexts. Project configuration,
plugins and patches remain trusted application input.

Yarn builds copy the excluded source context before installation, including the
public `.yarnrc.yml` and any committed patch/plugin files. This supports install
hooks and patches but means source changes can invalidate the dependency layer.
Zero-install/offline cache workflows are not provided by this strategy.

Node builds run `yarn workspaces focus --all --production` at the repository root
after compilation. This removes development dependencies while preserving all
workspace production dependencies and their links. It retains the complete
repository layout; it does not minimize the image to the selected app's dependency
closure. Static builds copy only the generated web output into Nginx.
See Yarn's [immutable install](https://yarnpkg.com/cli/install),
[production focus](https://yarnpkg.com/cli/workspaces/focus) and
[configuration](https://yarnpkg.com/configuration/yarnrc) references.

## Workspaces and credentials

Use root `package.json` workspace declarations, an exact root Yarn pin and the
root `yarn.lock`. Select the app with `ship init --workspace apps/api`. Local
packages can use `workspace:*`; build order and supported framework modes follow
[the workspace guide](workspaces.md). Nested workspace package-manager
configuration is rejected so one root configuration drives the install.

Keep `.yarnrc.yml`, committed plugins and patch files free of credentials: these
are application source files and can be copied into Node images. `build.npmrc`
is rejected for Yarn because modern Yarn does not consume that npm secret as its
registry configuration. Keep Yarn registry tokens out of tracked configuration,
lockfiles, URLs, and `build.publicEnv`. Runtime values and explicit build-command
secrets retain their existing [environment boundaries](environment.md).

The [Docker test suites](verification.md) exercise representative Yarn and
framework combinations.
