# npm prereleases

The package name is **`js-ship`**, hosted in `ship-ecosystem/js-ship` on GitHub.
It is unscoped, so an npm organization is not required. GitHub organization
membership does not grant ownership of the npm name. The first successful npm
publish creates the package; a repository metadata URL alone does not create it.

Nothing in the preparation below publishes a package. The current manifest keeps
`private: true` and `0.1.0-dev.0`. GitHub Actions workflows are currently disabled
to conserve the free account's remaining minutes. Continue previews locally; do
not enable or dispatch workflows until the user authorizes pre-release CI.

When enabled, the publishing workflow runs a preview on relevant
changes; actual publication requires an explicit manual dispatch on a prepared
prerelease tag with `publish` selected. There is no automatic tag-triggered publish.

## Preview now

Use a supported patched Node runtime, then run:

```sh
npm ci
npm run release:check
npm run check
npm run test:package -- /tmp/js-ship-preview
```

Choose a fresh output directory. The last command builds, packs and installs the
package into an isolated consumer, exercises the CLI, public exports, extension
API and TypeScript declarations, then retains the exact tested tarball as
`js-ship.tgz`. It rejects unexpected package roots and credential-file paths.
Preview does not authenticate to npm, reserve the name or verify publishing rights.

In GitHub Actions, **npm prerelease** runs these checks and uploads `npm-package`
for seven days. To request a preview manually, select a branch or tag and leave
`publish` false. The preview job has no OIDC permission and cannot reach the
workflow's publishing step. Private-repository artifacts remain private.

## Prepare the first public test

After the remaining package work and an explicit release decision:

1. Confirm that the intended npm account has a verified email, can authenticate
   with its required second factor and can own `js-ship`. Check the public registry
   again immediately before publishing; availability is not a reservation. If the
   name is already owned, resolve ownership rather than changing it silently.
2. Make the GitHub repository public and enable private vulnerability reporting.
   Review the README/security status text for public prerelease testing.
3. Choose `0.1.0-alpha.0` (or the next unused alpha/beta/rc version). Run
   `npm version 0.1.0-alpha.0 --no-git-tag-version` to synchronize both manifests,
   explicitly set `private: false`, and move the release notes from `Unreleased`
   into a matching `## 0.1.0-alpha.0` section. Keep an empty `## Unreleased` section.
4. Commit, run the full quality/integration checks and preview the tarball. Create
   a matching `v0.1.0-alpha.0` tag pointing to the reviewed commit. Protect release
   tags through repository rules so only maintainers can create or move them.

The checked-in `publishConfig` fixes the registry to npmjs.org, public access and
`next`. The policy rejects development and stable releases; stable publication
needs a later policy change. Do not use `latest` during prerelease testing.

## First-publish ownership bootstrap

npm's documented trusted-publisher setup is in an existing package's settings.
If `js-ship` does not exist under our ownership yet, the initial public publish
must establish that ownership before configuring this workflow as a trusted
publisher. Do this only at the release step above, from the reviewed public tag,
using a fresh tested tarball:

```sh
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
npm publish /absolute/path/to/js-ship.tgz --ignore-scripts --access public --tag next --registry=https://registry.npmjs.org/
```

The account completes npm's interactive authentication. Do not paste credentials
into the repository or add a persistent write token to GitHub. A local bootstrap
publish has no GitHub Actions provenance; do not claim that it does. Do not rerun
the publish workflow for that same version: npm versions cannot be reused. Check
`npm owner ls js-ship` and package settings after the bootstrap.

See npm's [public package guide](https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages/)
and [trusted-publisher setup](https://docs.npmjs.com/trusted-publishers/).

## Connect trusted publishing for subsequent versions

Create the GitHub environment **`npm`** and configure its release-tag restrictions
and any maintainer approval policy. The workflow uses this environment only for
publication. In the npm package's trusted-publisher settings choose GitHub Actions:

| Field | Value |
| --- | --- |
| Organization/user | `ship-ecosystem` |
| Repository | `js-ship` |
| Workflow filename | `npm-release.yml` |
| Environment | `npm` |
| Allowed action | Direct `npm publish` |

Use exactly those case-sensitive values. The environment and trusted-publisher
settings are account/repository configuration; committing the workflow does not
create them. npm currently requires a new trust configuration's first successful
publish within two days, so configure it close to the next release. See the
[configuration expiry policy](https://docs.npmjs.com/trusted-publishers/#trusted-publisher-configuration-expiry).

For the next unused prerelease, complete the version/changelog/tag steps above.
Select **npm prerelease → Run workflow**, choose the exact `v<version>` tag, and
select `publish`. The workflow checks the public repository identity, matching
manifest/lockfile/tag, `private: false` and release notes. It tests a tarball in a
job with read-only permissions, then publishes that artifact in a separate
GitHub-hosted job with `id-token: write`, no rebuild and no npm token secret.
`--ignore-scripts` prevents a second lifecycle build during publication.

The publish command explicitly requests provenance. npm supports provenance for
public packages built in public repositories on supported hosted runners; see
[provenance requirements](https://docs.npmjs.com/generating-provenance-statements/).
Preview cannot prove OIDC authorization or provenance; those require a real
publish after configuration. Review the resulting package version, provenance
link and `next` dist-tag before announcing it. A successful registry publish
cannot be repeated just because a later verification step fails.

Users can try a prerelease with `npm i js-ship@next` and run `npx ship --help`.
Once public, verify installation from the registry in a clean consumer, including
an actual fixture project, before announcing availability. Keep `latest` untouched
until a stable release is deliberately approved.
