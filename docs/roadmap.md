# Roadmap

## Implemented foundation

- All fourteen requested framework adapters plus generic Node, with the supported
  modes in [frameworks](frameworks.md).
- Pinned npm/pnpm/Yarn 4 node_modules, workspaces and explicit shared build order.
- Node/static/isolated production packaging, build secrets/public values, private
  npm/pnpm registry configuration and reviewed runtime floors.
- Persistent services, named instances, stable rename identities and database shells.
- Production workers/HTTP processes, deploy commands, signal supervision and
  explicit runtime files for traced/bundled outputs.
- Configuration validation, read-only doctor diagnostics, overrides and proxy commands.

## PHP ecosystem parity pass — November 23, 2026

- JavaScript settings registered in the local canonical schema; unmodified schema
  copies and a shared-checker drift tool added to js-ship.
- Canonical `ship-release` metadata, image IDs/platform, source revision, owned
  archives versus digest-pinned registry images, HTTP/service/console metadata,
  environment names, networks and one deployment execution plan.
- `--no-env`, explicit `--force` replacement with previous-artifact preservation,
  private files, executable deployment scripts and manifest-last publication.
- Process command/health/HTTP objects and multiple external networks.
- Complete portable provider catalog from PHP Ship, plus Selenium and Bull Board;
  browser tooling and Mailpit excluded from production.
- Rich stateful setup wizard, grouped selections, named instances, process script
  suggestions/custom processes, back navigation, plain fallback and automation flags.
- Missing development settings and production examples; existing values preserved.
- Container-based package-manager switching with consent and recorded-file recovery.
- Optional Mutagen development synchronization and initial-install gating.
- Optional validated adapter/service capability hooks, retaining extension API v1.
- README/docs reorganized around the shared ecosystem workflow and operational needs.

Each implementation step is committed locally. This pass does not push, publish,
change repository visibility, enable workflows or run GitHub Actions. Check
[verification](verification.md) for current local evidence and
[ecosystem compatibility](ecosystem-parity.md) for schema publication dependencies.

## Release gates remaining outside local implementation

1. Review and publish the local shared-spec changes so remote tools can consume
   the registered JavaScript settings; refresh other producers' copies separately.
2. Explicitly authorize final CI once the Actions budget permits. Earlier CI is
   historical evidence, not coverage for this pass.
3. Choose candidate metadata/release notes, make the repository public when ready,
   configure npm account/trusted publishing and publish public test prereleases.
4. Exercise the candidate through the shared deployment tooling on a clean target
   and record platform/framework versions before making production-readiness claims.

## Future compatibility expansion

Broader framework versions/options, nonrepresentative platform/browser matrices,
Gatsby SSR/DSG, other isolated SSR workspace layouts, Bun and Yarn Plug'n'Play are
additional work. They are not silently accepted as supported configurations.
Hosted-provider TLS/failover, infrastructure upgrades, backup restoration and remote
Docker endpoint reachability need provider/deployment-specific validation.
