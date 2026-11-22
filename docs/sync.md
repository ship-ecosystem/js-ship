# Optional Mutagen development sync

Like PHP Ship, JavaScript Ship supports `SHIP_MUTAGEN=1 ship up` as a personal
machine preference. It is useful on Docker Desktop when bind-mount performance is
slow. Install [Mutagen](https://mutagen.io/documentation/introduction/installation)
first; it is never downloaded or installed automatically. Unset the variable to
use the default bind mounts. Production never uses synchronization.

The development source mount becomes a persistent `ship_source` volume, shared
with source-mounted browser runners. Dependency volumes remain separate. Ship
creates a project-labelled two-way-resolved sync session, flushes the initial sync,
then permits the container's frozen dependency install and app startup. Node runs
the container endpoint so created files retain appropriate ownership. `ship down`
terminates only this project's labelled session, even if the preference was unset.

node_modules, VCS metadata, production environment files, private npmrc/build
secrets, release folders and Yarn caches are excluded. Never rely on synchronization
as a backup. Container-generated project/lockfile edits can synchronize back to the
host; review them as normal source changes. `ship down --volumes` deletes the sync
cache and dependency volumes as well as infrastructure data, but not host sources.

When an interrupted initial sync leaves the app waiting, inspect `mutagen sync
list` and rerun `SHIP_MUTAGEN=1 ship up`. Ship refreshes app and the session endpoint
on each explicit up. Docker/Mutagen must refer to the same daemon and container;
remote endpoints and native platform combinations require their own validation.
