# Initialization and diagnostics

## Interactive initialization

Run `ship init` from an application or workspace root containing package.json.
When stdin and stdout are terminals and CI mode is not enabled, Ship asks for
choices not already supplied as flags. Rich terminals use pinned `@clack/prompts`
with arrow-key selections, service category checkboxes and inline validation.
Ctrl+U goes to the previous logical question; changing a choice recomputes later
branches. Dumb/no-color terminals use numbered questions and `:back`. It discovers workspace packages before
framework detection and shows defaults from existing configuration and manifests.

| Choice | Equivalent flag |
| --- | --- |
| Stable application name | `--name my-app` |
| Container Node major | `--node 24` |
| Service provider | `--service storage=garage` (repeatable) |
| Production process | `--process worker="npm run worker"` (repeatable) |
| External networks | `--network proxy` (repeatable) |
| Deployment commands | `--deploy-command "npm run migrate"` (repeatable) |
| Workspace application | `--workspace apps/web` |
| Framework | `--framework react` |
| Deployment | `--deployment static` |
| Angular application | `--angular-project frontend` |
| Package manager | `--package-manager npm`, `pnpm` or `yarn` |
| Exact manager version | `--package-manager-version 12.2.2` |
| Primary database | `--database postgres`, `mongodb` or `none` |
| Primary cache | `--cache redis` or `none` |
| MongoDB mode | `--mongodb-mode replica-set` or `standalone` |

Workspace, Angular and MongoDB questions appear when relevant. Configured extension
adapters and services are available as choices. The wizard selects categories
then a provider per category, keeps/removes named instances and processes, offers
existing worker/realtime package scripts, and supports custom command/health/HTTP
process definitions. It previews generated file changes before confirmation. A
package-manager declaration in package.json must agree with the selected pin;
Initialization does not switch lockfiles, install dependencies or rewrite package.json.

Supplied flags take precedence and are not prompted again. Existing advanced
ship.json settings, named instances, workspace build order and edited templates
are preserved by the same initializer used for automation. Stale templates still
require an explicit `--force`; the wizard does not enable it automatically.
Existing [extension modules](extensions.md) execute trusted host code during
planning, just as they do for non-interactive configuration commands.

After validating the plan, Ship shows a summary and asks for `yes` or `no`.
The default is `no`. Answering no or pressing Ctrl+C cancels with exit code 130;
closing input cancels with exit code 1. Ship writes its project files only after
confirmation. Initialization validates the selected framework's documented
requirements; selecting a mode does not configure the framework itself.

## Automation

`--no-interaction` suppresses questions, including when a terminal is available.
Piped input/output and CI mode also retain non-interactive initialization.

```sh
ship init --no-interaction --framework generic --deployment node \
  --package-manager npm --package-manager-version 12.2.2 \
  --database mongodb --mongodb-mode replica-set --cache redis
```

Add `--workspace PATH` for a new workspace project. `none` removes a configured
primary database/cache selection; additional named services remain configured.
Unsupported modes, missing scripts, conflicting package-manager pins/lockfiles
and unsafe paths fail before Ship writes files. Flags and interactive choices
share the same validation and template-generation path.

Init appends missing development settings to `.env` and `.env.example`, and
creates/updates `.env.production.example` with `CHANGE_ME` for required credentials.
Existing values and comments are retained; `.env` is private. Create your own
`.env.production` with real credentials before building. Configuration JSON never
contains those secret values.

## Doctor

```sh
ship doctor
ship doctor --json
```

Doctor works before initialization and with missing generated files. It checks
Ship's development project settings, manifests, template metadata/files, build
exclusions and selected build-secret files. It reports Docker CLI availability,
Compose compatibility and daemon access independently. Compose 2.24.0 or newer
is needed for the generated optional env-file settings; see Docker's
[env-file reference](https://docs.docker.com/reference/compose-file/services/#required).

When Compose is available, doctor validates the effective development model using
the generated configuration on stdin, the development `.env` selection and the
same override precedence as other development commands. No generated Compose file
is written. When the daemon is also available, it inspects only containers
labelled with that effective development project identity. It reports unhealthy,
restarting, failed, stopped, starting, paused, missing and orphaned services.
MongoDB health failures include a reminder to check persisted credentials and
primary election while preserving data/config volumes. One-off Compose containers
are excluded. Production release directories are not discovered or loaded
automatically; checks follow the current development configuration's identity.

An override-added service is recognized by the effective model. An override or
`COMPOSE_PROJECT_NAME` that changes the project identity produces a warning;
container checks follow the effective identity. Doctor does not inspect the old
project automatically. Missing profiled services are skipped with a profile
warning; present profiled services still receive status checks. An override that
removes the configured app is an error because `ship up` and app proxies need it.

Doctor does not regenerate Compose files/templates, start or stop containers,
remove volumes or install packages. It requests selected status/label fields;
container environments, commands, logs and healthcheck output are not collected.
Compose validation can read environment files, includes and other referenced
configuration just as Compose normally does. Its resolved model is processed in
memory; only project/service metadata informs the report. Environment values,
endpoint addresses, context values and raw resolved configuration are not printed
or saved. Docker command failures produce fixed diagnostic messages rather than
raw stdout/stderr.
Configured extensions remain trusted host code and can have their own effects.

Text output marks each check `OK`, `WARNING` or `ERROR` and provides relevant next
steps. JSON contains `ok` and a `checks` array with `name`, `status`, `message` and
an optional `hint`. Exit code 1 means at least one error; exit code 0 can include
warnings such as a stopped stack. A running service without a healthcheck is
reported as such. Doctor validates override parsing/merging, not the behavior of
custom commands, images, mounts or healthchecks. It does not probe HTTP endpoints
or establish production readiness. Use `ship up` for startup/HTTP
readiness and [the recovery guide](recovery.md) for operational steps.

### Development override selection

Only the first existing file is selected: `docker-compose.override.yml`, then
`compose.override.yaml`. If both exist, doctor explains that the second is ignored.
The selection is identical for development commands; production builds and release
exports ignore these development overrides. An invalid selected override produces
an error and skips container inspection because its project identity is unknown.
Fix YAML, interpolation, referenced files or service dependencies before retrying.
See [Compose configuration](https://docs.docker.com/reference/cli/docker/compose/config/).

Doctor resolves the current configuration, so it cannot prove a running container
was created from the latest override. Recreate affected services after reviewing
changes. A project rename can leave the previous project's containers and volumes
in place; stop that previous stack using its original identity/configuration.
Doctor does not stop it or migrate data automatically.

### Docker endpoints and remote hosts

Doctor checks the SDK process environment: `DOCKER_CONTEXT` when set, otherwise
`DOCKER_HOST` when set, otherwise the configured context. Named contexts are inspected explicitly; context command
defaults can differ from the effective daemon selection. It reports only socket,
network or unknown endpoint classification and never the address, user, context
name or TLS material. See [Docker context/environment precedence](https://docs.docker.com/reference/cli/docker/).

A network endpoint produces guidance rather than an automatic failure: the daemon
may be remote or behind a tunnel. A Unix/named-pipe socket also does not prove
where the daemon runs. Docker Desktop has its own path-sharing mechanism; socket
forwarding and loopback TCP endpoints can hide a remote daemon.

Development bind mounts refer to paths on the daemon host, not the SDK host.
Published `127.0.0.1` ports and Ship's startup HTTP checks can also refer to
different machines. Doctor does not verify remote source synchronization, host
paths, port forwarding or network reachability. Use a local development daemon,
or arrange those facilities yourself. For deployment, copy a portable release to
the destination and use its generated loading/Compose instructions there; it
contains private environment values and must stay private. See
[Docker bind-mount constraints](https://docs.docker.com/engine/storage/bind-mounts/#considerations-and-constraints).
