# Initialization and diagnostics

## Interactive initialization

Run `ship init` from an application or workspace root containing package.json.
When stdin and stdout are terminals and CI mode is not enabled, Ship asks for
choices not already supplied as flags. It discovers workspace packages before
framework detection and shows defaults from existing configuration and manifests.

| Choice | Equivalent flag |
| --- | --- |
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
adapters and primary database/cache services are also available as choices. A
package-manager declaration in package.json must agree with the selected pin;
Ship does not switch lockfiles, install dependencies or rewrite package.json.

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

When the daemon and Compose are available, doctor inspects only containers
labelled with the configured development project name. It reports unhealthy,
restarting, failed, stopped, starting, paused, missing and orphaned services.
MongoDB health failures include a reminder to check persisted credentials and
primary election while preserving data/config volumes. One-off Compose containers
are excluded. Production releases are separate projects and are not inspected.

Doctor does not regenerate Compose files/templates, start or stop containers,
remove volumes or install packages. It requests selected status/label fields;
container environments, commands, logs and healthcheck output are not collected.
Docker command failures produce fixed diagnostic messages rather than raw stderr.
Configured extensions remain trusted host code and can have their own effects.

Text output marks each check `OK`, `WARNING` or `ERROR` and provides relevant next
steps. JSON contains `ok` and a `checks` array with `name`, `status`, `message` and
an optional `hint`. Exit code 1 means at least one error; exit code 0 can include
warnings such as a stopped stack. A running service without a healthcheck is
reported as such. Doctor does not probe HTTP endpoints, validate custom Compose
overrides or establish production readiness. Use `ship up` for startup/HTTP
readiness and [the recovery guide](recovery.md) for operational steps.
