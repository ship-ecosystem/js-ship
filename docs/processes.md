# Application processes

Workers, schedulers and app-owned Socket.IO/ws servers share the production app
image. They are separate processes/containers, not generic infrastructure servers.
They start in production only. During development, run the appropriate script
explicitly with `ship npm run worker` (or pnpm/Yarn), or add a development watch
service in a Compose override. Do not accidentally run two schedulers.

```json
{
  "processes": {
    "jobs": ["npm", "run", "worker"],
    "events": {
      "command": ["node", "dist/events.mjs"],
      "healthcheck": "node dist/check-events.mjs",
      "http": {
        "port": 4000,
        "role": "websocket",
        "health": "/ready",
        "urlSetting": "PUBLIC_EVENTS_URL"
      }
    }
  },
  "deployCommands": [["npm", "run", "db:migrate"]]
}
```

Use actual package scripts/files, not the example paths unless they exist. The
wizard suggests existing worker/queue/scheduler/realtime scripts; extensions can
provide richer suggestions. No handler or authentication implementation is invented
or installed. Scripts/argv run in the selected workspace app directory.

Shell strings run with `sh -c` **inside the container**. Argv lists preserve literal
arguments, including empty arguments and dollar signs. Use argv unless shell syntax
is intentional. Keep long-running commands in the foreground. The entrypoint
forwards SIGTERM/SIGINT to the process group; Node handlers should close listeners,
finish work and exit within the 60-second stop grace period.

## BullMQ and Bull Board

Install BullMQ (and the selected Redis client) in production dependencies and use
the configured `REDIS_URL`. Your worker loads your application handlers and queue
names. On shutdown, await the worker's close operation and close its Redis
connections. Set appropriate job timeouts, retries, idempotency and Redis eviction
policy for your workload; a queue worker's process remaining up is not proof that
jobs are being consumed. Supply a meaningful health command when available.

Select Redis/Valkey as cache and Bull Board under `queue-dashboard` to inspect
queues independently. Bull Board connects to Redis; it does not host handlers or
replace the worker. Prefer read-only dashboard access when operations are not
needed, and configure authentication/TLS. See [services](services.md).

## Socket.IO and ws

Run the project's own server entrypoint, binding `0.0.0.0` and honoring `PORT`.
Ship sets `PORT` to the process's declared HTTP port (4000 in the example), exposes
that port internally and attaches the process to configured external networks.
When a healthy HTTP path is declared, Ship creates a Node fetch probe requiring
2xx unless an explicit health command overrides it. Unknown paths remain null;
a successful WebSocket handshake is not inferred from an arbitrary HTTP response.

Reuse the application's authentication/session checks for upgrades and connections;
configure allowed origins, payload/rate limits and authorization for subscriptions
and messages. Socket.IO and raw ws speak different protocols. A browser Socket.IO
client needs a Socket.IO server; it cannot connect to a generic WebSocket server.
Configure the proxy for upgrades and the final public URL. Public frontend URL
values must be compiled using the framework's own public environment mechanism.

For a service requiring no project-owned server code, select Centrifugo instead.
Its publishing API and token-based browser connections are separate responsibilities.

## Packaging and deployment

Generic Node images retain the pruned app. Framework-traced/bundled images only
include their output: explicitly include worker/migration files with `runtimeFiles`
and ensure their imports are available in production. Static images cannot host
these processes. See [frameworks](frameworks.md) and [workspaces](workspaces.md).

Deploy commands run once from the app image after infrastructure is ready and
before the app is started. They are recorded as argv in `release.json` and used
by the same executable script with `run --rm --no-deps -T`. Commands are never
implicitly chosen from an ORM dependency. Make migrations safe to retry and do
not use a long-running worker as a deployment command.
