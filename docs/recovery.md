# Startup, shutdown and recovery

## A development stack does not become ready

Run these commands from the project root:

```sh
ship doctor
ship logs mongodb
```

Use the configured service name if it has been renamed. `doctor` reports project,
Docker, Compose and service-state checks with recovery hints; `doctor --json`
provides the same checks for automation. See [initialization and diagnostics](usability.md).
The command works with incomplete project files; `logs` shows the selected service's output. A failed
`ship up` can leave containers present so you can inspect them. It does not roll
back the stack or remove persistent data. Fix the reported cause and rerun
`ship up`; use `ship down` first when you need to stop the whole development stack.
Both commands preserve named database volumes. `ship down --volumes` explicitly
removes them and is for disposable data, not recovery.

Built-in databases and Redis have healthchecks. Development startup waits for
healthy dependencies before starting the app, then requires an HTTP response
before printing its Ready URL. A framework's HTTP 404 counts as a response; this
is not a check of every application endpoint or database query. Startup's Compose
wait and HTTP readiness wait each have a 180-second budget.

## Infrastructure fails after startup

Ship's built-in infrastructure services use `unless-stopped`. Docker can restart
an unexpectedly exited service; a deliberate stop remains stopped until you
explicitly start it again. See Docker's [restart policy details](https://docs.docker.com/engine/containers/start-containers-automatically/).

An unhealthy status alone does not mean the process has exited. Startup dependency
checks do not continuously restart application containers when a dependency fails.
Applications and workers need their own database connection retry/reconnect logic
and request-level handling. See [Compose startup dependencies](https://docs.docker.com/compose/how-tos/startup-order).

After correcting the infrastructure problem, run `ship up` to reconcile the
development stack. This explicitly recreates the development app and refreshes its
frozen dependency install. Production app/worker images also use `unless-stopped`;
run the release's documented Compose commands from its own directory to inspect
and start those services. Recovery does not require an application rebuild unless
you changed application code or its image.

## MongoDB credentials no longer match

MongoDB creates users when its data volume is initialized. Editing `.env` or
`.env.production` does not change passwords already stored in that volume.
A root-password mismatch prevents Ship's authenticated healthcheck/bootstrap from
succeeding, even if an existing application user can still connect. Healthcheck
output deliberately omits credential values.

If an environment edit was accidental, restore the known working values and
rerun startup. Keep both MongoDB volumes: the data volume holds users/data, and
the configuration volume holds the replica-set authentication key. For an
intentional password rotation, change the MongoDB user through authenticated
administration and coordinate the corresponding environment change. See
[MongoDB topology and credentials](mongodb.md).

## Slow application and worker shutdown

Generated Node app/worker services have a 60-second Compose stop grace period. Their
Node entrypoint forwards termination to the command's process group and allows
shell/npm descendants to finish draining. Handle `SIGTERM`, stop taking new work,
close listeners and finish or release work within that budget. After the grace
period, Docker can forcibly terminate remaining processes; see [container stop](https://docs.docker.com/reference/cli/docker/container/stop/).
A shorter explicit Compose timeout overrides the generated grace period.

The live lifecycle test exercises a 12-second app/worker-child drain without an
explicit timeout override. This does not establish behavior for drains longer
than 60 seconds or for every framework's shutdown hooks.

## Verification limits

The recovery fixtures use isolated disposable Linux Docker projects. They cover
unhealthy MongoDB startup, an unexpected mongod exit, manual stop/start, retained
records and transaction support after restart, credential mismatch/restoration,
volume/key identity and health-output credential omission. A running generic app
is observed across the database crash; application-driver reconnection is not
established by that fixture. Disk exhaustion, interrupted first-time database
initialization, host/daemon failure, backup restoration and MongoDB version
upgrades require additional checks. See [verification](verification.md).
