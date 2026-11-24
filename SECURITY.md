# Security policy

Security fixes target the newest release on the `next` distribution tag.

## Reporting

Use [GitHub private vulnerability reporting](https://github.com/ship-ecosystem/js-ship/security/advisories/new)
or an existing private maintainer contact channel. Include affected versions
and steps to reproduce. Share sensitive material through the private report.

## Runtime and image policy

The host CLI and generated Node builds enforce reviewed per-major Node minimums.
The minimum versions are Node 22.23.5, 24.22.3, and 26.13.1 in their respective
majors. See [runtime maintenance](docs/runtime-maintenance.md).

Default Node, Nginx, PostgreSQL, Redis and MongoDB parents are pinned to
multi-platform image digests. Updates require a reviewed catalog change and
regeneration of project templates. Existing images, running containers and
exported releases do not update automatically.

Explicit project extension modules execute trusted host code, even during configuration
validation. Entry-path checks are not a sandbox for their transitive imports.
Application build/install scripts and editable Docker/Compose overrides are
trusted project code. Ship cannot prevent them from persisting secrets they can
read. Public build variables may enter browser bundles. Exported releases may include
runtime credentials in `.env` and must be handled as private artifacts. `--no-env`
omits that file while retaining setting names; provision secrets on the destination.
Portable provider images use reviewed catalog tags and are pinned by resolved
digest in releases. Provider/runtime upgrades and persisted-data migrations require
separate review.
