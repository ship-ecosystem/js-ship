# Security policy

JavaScript Ship is in private development. No public release is supported yet.
During public prerelease testing, fixes will target the latest prerelease; older
prereleases may require an upgrade.

## Reporting

Before public testing, maintainers must enable GitHub private vulnerability
reporting. Use the repository's **Security → Report a vulnerability** flow when
available: https://github.com/ship-ecosystem/js-ship/security/advisories/new.
Until that is available, use an existing private maintainer contact channel.
Include reproduction steps and affected versions; keep credentials and exploit
payloads out of public issue reports.

## Runtime and image policy

The host CLI and generated Node builds enforce reviewed per-major Node minimums.
The initial November 17, 2026 baseline is Node 22.23.5, 24.22.3 or 26.13.1, based on
Node's November 11 security releases. Only stable releases in the supported majors
are accepted. See [runtime maintenance](docs/runtime-maintenance.md).

Default Node, Nginx, PostgreSQL, Redis and MongoDB parents are pinned to
multi-platform image digests. Updates require a reviewed catalog change and
regeneration of project templates. Existing images, running containers and
exported releases do not update automatically.

Explicit project extension modules execute trusted host code, even during configuration
validation. Entry-path checks are not a sandbox for their transitive imports.
Application build/install scripts and editable Docker/Compose overrides are
trusted project code. Ship cannot prevent them from persisting secrets they can
read. Public build variables may enter browser bundles. Exported releases include
runtime credentials in `.env` and must be handled as private artifacts.
