# First public alpha readiness review

**Superseded by the November 23 ecosystem parity pass.** The earlier review below
is historical. The release format, service catalog and prompt dependencies have
changed; see [roadmap](roadmap.md), [ecosystem compatibility](ecosystem-parity.md) and
[verification](verification.md). Current candidate approval requires the final
authorized CI run and publication of the local shared-spec changes.


Reviewed November 18, 2026, starting from `33381b4` and including the fixes in this
review. The package is ready for candidate preparation within the scope below.
It is **not approved for publication**: the real manifest remains private at
`0.1.0-dev.0`, the repository remains private, npm is unpublished and package
Actions workflows remain disabled. This review did not run GitHub CI.

## Findings and evidence

| Area | Result |
| --- | --- |
| Requested framework/database scope | All fourteen adapters and MongoDB are implemented within the documented deployment modes. Representative builds exist; arbitrary version/mode/platform combinations are not claimed. |
| Package identity | Unscoped `js-ship`, GitHub `ship-ecosystem/js-ship`, MIT license, CLI, ESM/types/schema exports and explicit package contents are prepared. At that review there were no runtime dependencies; the parity pass adds Clack. |
| Release blocker fixed | CLI and exported Docker-release provenance used a hardcoded development version. Both now read the installed package manifest, so changing the npm version does not require editing TypeScript. |
| Candidate validation gap fixed | `npm run release:check -- --candidate` checks non-development prerelease metadata, `private: false`, matching lockfile records and release notes offline. It does not authenticate, publish, create a tag or attest repository visibility. |
| Local checks | 187 unit/boundary cases passed with no skips. A version-bump regression checks CLI/help and mocked Docker-release provenance. An isolated `0.1.0-alpha.0` copy passed candidate validation and an installed-tarball consumer check. |
| Dependency audit | npm audit reported zero advisories for the current lockfile, including development dependencies. This is a point-in-time registry result. |
| Documentation | Local file links resolve. Framework, workspace, environment, credential, recovery and diagnostics limits are documented. |
| Repository history | A limited scan of the 21 reachable commits found no credential-file paths or common npm/GitHub/AWS token/private-key literals. This is not a comprehensive secret-scanner attestation. |
| npm/account | An unauthenticated [public registry lookup](https://registry.npmjs.org/js-ship) returned 404 for `js-ship`; this neither reserves the name nor proves it can be registered. The local npm CLI needs login. Email/second-factor readiness and publishing rights are not verified. |
| GitHub/CI | Private repository and four manually disabled package workflows confirmed. Earlier CI predates recent features; those results do not establish final-candidate CI coverage. |

The version-bump rehearsal changed only a temporary copy, kept credentials out of
that copy, and made no registry writes. Its artifact is a rehearsal, not an
approved release. The working package's version/private flag were not changed.
Detailed historical/local coverage is in [verification](verification.md).

## Proposed alpha scope

The first alpha should test existing development environments and portable
releases for the documented framework modes, PostgreSQL/Redis/MongoDB, npm/pnpm,
Yarn 4 node_modules, explicit workspaces, workers/deploy commands, extensions,
configuration validation and doctor diagnostics. Linux Docker has representative
live coverage; earlier host CLI checks cover Linux/macOS/Windows. Current changes
still need the authorized final platform/integration round.

The following remain later work, rather than reasons to expand the first alpha:
Bun, Yarn Plug'n'Play/older majors and Yarn registry authentication; additional
infrastructure services; other isolated SSR workspace layouts and minimal app-only
dependency closures; Gatsby SSR/DSG; broader subpaths/framework versions/browser
HMR; Mutagen; hosted-provider TLS/SRV/failover; authenticated private-registry
downloads; backup restoration and host/daemon failure drills. Keep these limits
visible to testers. They are not production-readiness claims.

Nuxt's tested workspace shared-library output is ESM; the documented CommonJS
interop failure is unresolved. Doctor validates Compose merging and metadata,
not remote source/port reachability or custom service behavior. See
[workspace limits](workspaces.md) and [diagnostics](usability.md#doctor).

## Required release gates

1. **Prepare a real candidate after the release decision.** Choose the next unused
   alpha version, synchronize manifest/lockfile records, explicitly clear
   `private`, add matching release notes while retaining `Unreleased`, and update
   README/security status for public alpha testing. Run the offline candidate
   check and package consumer check. Keep the repository/workflows unchanged
   until their separate release actions are authorized.
2. **Complete account readiness.** Log into the intended npm account interactively,
   verify its email/required second factor and recheck the name/version immediately
   before publication. A missing registry entry is not ownership. Use the documented
   first-publish bootstrap; configure trusted publishing only once the package
   exists. See [npm preparation](npm-release.md).
3. **Authorize visibility and final CI explicitly.** Review the final source/history
   and public status, make the repository public when approved, and enable private
   vulnerability reporting. Re-enable/dispatch the agreed CI workflows only after
   the user's pre-release CI authorization. Do not interpret ordinary requests to
   continue package work as permission for CI or publication.
4. **Verify one exact candidate.** Run quality/platform/package checks,
   Docker/browser integration, cross-runner transfer and the non-publishing npm
   preview against the same candidate commit/tag. The prepared Docker matrix has
   19 suites/43 cases; browser coverage has six cases. Record the actual results
   and fix failures before publication. A source fix requires a newly reviewed
   candidate and appropriate checks; a historical green run is insufficient.
5. **Publish and verify only after approval.** Tag the reviewed commit and publish
   the exact tested tarball under `next`; keep `latest` untouched. Confirm registry
   ownership, version and dist-tag, then install in a clean consumer and exercise
   a real project before announcing it. Never republish an already used version.

## Actions budget and publishing configuration

Keep all four package workflows disabled during local preparation. A budget-aware
release sequence can make the reviewed repository public before the authorized
final CI round: standard GitHub-hosted runner compute is free for public
repositories. This is an option for the release window, not authorization to
change visibility or run CI now. Storage and other metered services have separate
billing rules. See [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

Commit candidate changes while workflows are still disabled. During the agreed
verification window, avoid unrelated pushes/dispatches and duplicate test rounds;
record commit SHAs and results. Workflow schedules/push triggers must not be left
to consume private-repository minutes unintentionally.

The GitHub `npm` environment, tag restrictions and npm trusted-publisher connection
remain release configuration work. GitHub Free deployment environment protection
rules are available for public repositories; do not assume they can be configured
on this private free-plan repository. See [GitHub environment availability](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).
The first successful manual bootstrap has no Actions provenance. Later trusted
publishes need the exact repository/workflow/environment and permitted publish
action configured on npm; local previews cannot verify OIDC. See
[npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).
