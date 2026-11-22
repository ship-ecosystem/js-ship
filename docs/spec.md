# JavaScript Ship implementation contract

The ecosystem's source of truth is [ship-ecosystem/spec](https://github.com/ship-ecosystem/spec).
This document describes the JavaScript producer. Unmodified canonical schemas are
bundled in `schema/canonical/`; `npm run check:spec -- PATH_TO_SPEC` checks drift.
The generated draft-07 editor profile adds JS/framework restrictions without
claiming the canonical schema's identity. The canonical schema is draft 2020-12.
Local JavaScript schema additions await publication in the shared repository.

## Shared workflow

`init` plans and validates project configuration before asking to write templates,
configuration and missing environment settings. It detects workspaces before the
framework; existing choices and user template edits are retained. Rich Clack and
plain numbered renderers share the same stateful wizard and domain planner.
Back navigation recomputes dependent answers. Non-interactive operation never asks
questions. Cancellation writes no project files and restores terminal state.

`up` is development only. It builds, installs frozen dependencies into isolated
volumes, starts services and checks container/HTTP readiness. Every explicit up
refreshes app; infrastructure follows normal Compose reconciliation. Production
process definitions do not implicitly run in development. Optional `SHIP_MUTAGEN`
replaces source binds with synchronized volumes and gates install on initial sync.
Overrides apply only to development. `doctor` uses the effective model without
regenerating files and redacts diagnostic environment/endpoint information.

`build` creates project-owned production images. `release` stages the shared
portable artifact, with `release.json` written last and atomic folder publication.
`exec`, `shell`, `logs`, `db`, package-manager proxies and `test` operate in containers.
`package-manager` explicitly confirms a lockfile/tool switch and restores recorded
project files after an installation failure. All subprocesses use argv without a
host shell. Signals and exit codes are forwarded; bounded operations use deadlines.

## Runtime and packaging

Ship is TypeScript compiled to ESM/declarations. Host/runtime Node versions meet
reviewed floors from the digest-pinned core image catalog. npm/pnpm/Yarn versions
are exact, checked against package.json and the authoritative lockfile. Yarn uses
node_modules, never Plug'n'Play. Application and framework configuration is read
as data; configured extension modules are trusted host code.

All fourteen requested adapters plus generic Node are built in. Specific framework
detection precedes base libraries. Adapters supply dev/build/start commands and
Node/static/isolated output plans; core owns Docker execution. See [frameworks](frameworks.md)
for required framework configuration and supported modes. App-owned workers and
migration code must be present in the production output, with runtime dependencies.
Static images contain Nginx as UID 101, no Node commands or workers.

Workspaces retain root lockfile authority, ordered explicitly selected shared
builds and per-package dependency volumes. Generic Node output retains the pruned
workspace layout. Next standalone and Nuxt Node can preserve isolated output at
the selected app path. Other isolated SSR workspace placements fail explicitly
until supported; see [workspaces](workspaces.md).

Node production apps and processes run unprivileged with Docker init, restart
policy and 60-second graceful stops. The app entrypoint supervises child process
groups without breaking interactive TTY execution. Development defaults to host
UID/GID on Linux. Template format 9 adds the optional initial-sync install gate;
older edited templates require review and explicit refresh.

## Configuration and services

Common fields retain ecosystem meanings: stable `name`, one service per group,
named additional instances, Compose service renames, external network name/list,
production `processes`, `deployCommands`, `publishPorts`, `hostUser`, extensions
and Silo variant. JavaScript-specific fields describe framework/runtime, package
manager/scripts, ports, workspace/build settings and output packaging.

Processes are strings, argv or `{ command, healthcheck?, http? }`. HTTP metadata
contains port, open role, known healthy path or null, and public URL setting name
or null. HTTP health probes use literal argv; custom health commands use a shell
inside the container. Names and paths are validated before Docker operations.

Persistent resource identities use provider/instance, not renamed service hosts.
Existing production Compose names keep their `-production` suffix. Do not change
that prefix without migrating data. Selected services contribute protocol settings
but never install JS clients or framework drivers. Browser tools and Mailpit are
development-only. Cypress is on demand. BullMQ/Socket.IO/ws use app-owned process
code; Bull Board and Centrifugo are independent services. See [services](services.md).

## Environment boundaries

Runtime environment files are excluded from Docker build contexts. Public build
values are explicit literals; BuildKit secret files and optional npmrc credentials
are temporary mounts. Frontend public prefixes cannot be declared build secrets.
Static apps never receive infrastructure secrets. Database admin credentials are
not injected into app clients. Environment examples retain user values and comments;
production examples contain placeholders, not usable generated credentials.

Build/release reject missing required production settings and known development
credentials. Adapter capabilities can declare additional required names and real
HTTP/console metadata. No application-specific route or ORM command is invented.
See [build environment](build-environment.md) and [environment](environment.md).

## Release contract

The manifest includes `format`, stable app, tag/time, builder/source, platform,
Compose path, archived and pulled images, services, HTTP endpoints, framework/runtime,
environment names, deployment plan, external networks and console information.
Only project-built images are archived, once per unique image, with immutable IDs
and SHA-256. Other images are pinned by repository digest. All project-built images
must share one platform. The default artifact needs registry access on the target.

Release Compose contains no source mounts, builds or build secrets. Secrets stay
in optional `.env` (0600), never in release.json. `--no-env` retains setting names
but no settings file; provision destination settings before starting services.
Directories are 0700; deploy scripts are 0755. Metadata/script use one command
plan (`run --rm --no-deps -T`) after infrastructure readiness. Existing tags need
explicit `--force`; failed assembly preserves the previous artifact.

The shared checker validates schema, cross-field references, Compose identities
and archive hashes. Run `npm run check:release -- PATH_TO_RELEASE`. Actual folder
checks supplement unit tests; source-free Docker startup establishes runtime
behavior. Cross-host/multi-platform guarantees require their own verification.

## Extensions and validation

API v1 remains compatible, with optional HTTP/lifecycle, release-description and
process-suggestion hooks. Module paths are explicit, relative and contained in the
project. Registries are project-local, built-ins cannot be replaced, volumes must
be declared and templates are namespaced. See [extensions](extensions.md).

Local tests cover malformed configuration, planning, framework output, schemas,
release failure boundaries, terminal state, package-manager recovery and installed
tarballs. Docker suites exercise actual services and representative framework
builds. [Verification](verification.md) records tested scope and limits.
GitHub Actions stay disabled until explicit pre-release authorization. No ordinary
implementation request authorizes pushing, publishing or changing visibility.
