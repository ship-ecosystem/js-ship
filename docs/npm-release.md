# Publishing JavaScript Ship to npm

Publish `@shipecosystem/js-ship` from the public `ship-ecosystem/js-ship` repository.
Each npm version corresponds to a Git tag such as `v0.1.1`. Use exact versions for
repeatable installs. npm reserves version-shaped names for versions and assigns
its default `latest` alias on publish. Introduce a changelog for `1.0.0`.

## Prepare the release

1. Use an npm account with two-factor authentication and permission to publish
   under the `shipecosystem` organization. Check that the version is unused.
2. Update `package.json` and `package-lock.json` together with
   `npm version VERSION --no-git-tag-version`. Set `private` to `false`.
3. Run the checks below. Choose a new directory for the tarball output.

   ```sh
   npm ci
   npm run check
   npm run release:check -- --candidate
   npm run test:package -- /tmp/js-ship-release
   ```

4. Run the quality, Docker integration, and release-transfer workflows on the
   candidate commit. Once they pass, tag the commit `vVERSION`. Restrict creation
   and updates of release tags to maintainers through repository rules.

The package test builds and installs the tarball in a clean consumer, checks the
CLI and public exports, and retains the tested artifact as `js-ship.tgz`. The
candidate check validates local metadata. To build a preview artifact in GitHub
Actions, run `npm-release.yml` with `publish` disabled.

## First release

Publish from a clean checkout of the tested version tag using an authorized npm
account. npm runs `prepack` to build the distribution before uploading it.

```sh
npm ci
npm whoami --registry=https://registry.npmjs.org/
npm publish --access public --tag latest --registry=https://registry.npmjs.org/
```

Verify with `npm view @shipecosystem/js-ship@VERSION version`, then install that
exact version with `npm install --save-exact @shipecosystem/js-ship@VERSION` in
a clean project. Confirm `npx ship --version` reports the tagged version.

## Trusted publishing

Create a GitHub environment named `npm` with release-tag restrictions. In npm's
[trusted publisher settings](https://docs.npmjs.com/trusted-publishers/), authorize
direct publication from GitHub Actions with these values:

| Field | Value |
| --- | --- |
| GitHub organization | `ship-ecosystem` |
| Repository | `js-ship` |
| Workflow filename | `npm-release.yml` |
| Environment | `npm` |

Configure the trust shortly before the next release so its first successful
publish can validate the connection. For subsequent versions, manually dispatch
the **npm release** workflow on the exact `vVERSION` tag with `publish` enabled.
The workflow tests the artifact in a read-only job, then publishes that tarball
with OIDC and provenance from a separate job. Each npm version is published once.
