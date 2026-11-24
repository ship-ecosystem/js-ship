# Runtime maintenance and dependency updates

## Reviewed Node baseline

Ship requires these minimum versions:

| Node major | Minimum stable version |
| --- | --- |
| 22 | 22.23.5 |
| 24 | 24.22.3 |
| 26 | 26.13.1 |

Later stable patch/minor releases within these majors are accepted on the host.
Unsupported majors, prereleases and versions below the floor are rejected before
CLI commands run. Package `engines.node` declares the corresponding ranges.

`ship.json` continues to select a Node major, such as `"node": "24"`. Ship resolves
that to the reviewed patch and image digest from its catalog. Generated Dockerfiles
run the same version validator before package-manager installation. Overriding the
base image manually does not bypass its runtime floor check. A matching version
number does not establish that an arbitrary custom image is trustworthy.

The policy is a bundled, reviewed baseline, not an online advisory lookup. New
security releases need prompt maintainer review. Upstream end-of-life dates also
need review; removing a supported Node major is a deliberate compatibility change.

## Reviewed image catalogs

`images/Dockerfile` is the source of default Node, Nginx, PostgreSQL, Redis and
MongoDB image references. Each `FROM <image> AS <key>` entry is read by the build
generator and Dependabot's native Docker manager. Preserve that format when
editing it. The file is a catalog, not an application build.

Every reference includes a multi-platform manifest digest. Node entries additionally
pin a full patch tag; infrastructure entries keep their existing version families.
Do not change PostgreSQL/Redis majors or MongoDB release families as routine image
refreshes. Database upgrades require separate compatibility and migration review.

`npm run build` regenerates `src/images.ts`, the Node engine ranges in package.json
and package-lock.json, and the configuration schema. CI checks that these generated
artifacts were committed. A catalog update PR must include the generated changes:

```sh
npm run build
npm run check
npm run test:package
```

If a new floor rejects your local Node version, upgrade it or run these checks
using a separately installed patched runtime. This does not require changing the
application's selected container Node major.

## Update automation

`.github/dependabot.yml` configures weekly npm development-tool and pinned GitHub
Action updates, plus daily image-catalog checks. Container major-version updates
are excluded from routine proposals; MongoDB minor-family upgrades are also excluded. There is no automatic merge or deployment.
Digest changes and database image refreshes still require review.

Update checks use the configuration on the default branch and follow the
repository and organization settings. See [GitHub's supported ecosystems](https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories)
and [Dependabot configuration](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference).

Quality CI checks the generated artifacts and runs `npm audit --audit-level=high`
in a separate job, including on the weekly schedule. Docker CI runs for catalog
changes and weekly regression checks. The npm audit covers SDK development-tool
packages as well as runtime dependencies (including the pinned Clack prompts). It is not an application
or container OS vulnerability scan. The package-manager bootstrap pin and embedded
framework test fixtures still need deliberate maintenance; they are not discovered
as ordinary package dependencies by this configuration.

## Applying an SDK/image update to an application

Current templates use format 9. Updating Ship alone does not overwrite editable
project templates or rebuild running images. After reviewing custom changes:

```sh
ship init --force
ship build
ship release --tag NEW_RELEASE_TAG
```

Use `ship up` for a development refresh. Production deployments must use the newly
built release through the normal deployment process. Catalog changes are part of
the template fingerprint, so stale templates fail explicitly instead of silently
building with an older parent policy.

`ship build` pulls the selected immutable parent references. `--pull` does not move
a digest to a newer image; update the SDK/catalog and templates first. `--no-cache`
invalidates build steps but also does not select a newer parent digest. Release
metadata records the catalog and Node floors used by Ship. These describe the
reviewed defaults; custom templates and overrides can change actual build behavior.

Existing archives and loaded images remain fixed snapshots and do not receive
patches automatically. Retest and rebuild them when a relevant advisory appears.
Digest pinning and version floors are reproducibility/maintenance controls, not a
claim that all application or operating-system vulnerabilities have been eliminated.

Portable provider tags live in `images/services/Dockerfile`; the same generator
writes `src/service-images.ts`, used by service definitions and Garage templates.
Dependabot checks this catalog separately. The Silo variants must move together;
Playwright's server package version is derived from its image tag. Provider tags
may track a reviewed release branch; exported releases always pin the resolved
registry digest. Review upstream compatibility before accepting provider updates.
Both core and portable catalog versions participate in template metadata, so SDK
image updates require explicit template review/refresh before project builds.
