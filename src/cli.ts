#!/usr/bin/env node
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { initProject } from "./init.js";
import { composePrefix, loadProject } from "./project.js";
import { buildCompose, selections } from "./compose.js";
import { productionProblems } from "./production.js";
import { assembleRelease, buildProduction, VERSION } from "./release.js";
import { run } from "./process.js";
import { ConfigError, ProcessError } from "./errors.js";
import { waitForStack } from "./runtime.js";

const HELP = `JavaScript Ship ${VERSION} — development milestone

Usage: ship [--project-directory PATH] COMMAND [arguments]

  init [--database postgres|mongodb|none] [--cache redis|none] [--force]
       [--framework NAME] [--package-manager npm|pnpm]
       [--package-manager-version VERSION] [--no-interaction]
       [--deployment node|static] [--angular-project NAME]
       [--mongodb-mode standalone|replica-set]
  up                         Build, start, wait for services and HTTP
  down [--volumes]            Stop; --volumes also deletes persisted data
  exec SERVICE COMMAND...    Execute in a running container
  shell [SERVICE]            Open sh (defaults to app)
  logs [SERVICE] [-f]         Show container logs
  db [INSTANCE]              Open the selected database client
  npm ARGUMENTS...           Run npm inside app (arguments passed unchanged)
  pnpm ARGUMENTS...           Run pnpm inside a pnpm app
  config:test                Check project and both Compose models, no Docker
  doctor                     Report Docker/Compose versions and stack status
  build                      Build project-owned production images
  release --tag TAG          Export a Docker-only release under dist/ship/TAG

Adapters: generic, react, vue, angular, svelte, nestjs, fastify, expressjs,
          next, nuxt, sveltekit, astro, vitepress, tanstack-start, gatsby.
Package managers: pinned npm and pnpm. Services: PostgreSQL, Redis, MongoDB.
Deployment modes and verification status are documented in docs/frameworks.md.
`;

function options(args: string[], definitions: Record<string, { type: "string" | "boolean" }>): Record<string, string | boolean | undefined> {
  return parseArgs({ args, options: definitions, strict: true, allowPositionals: false }).values;
}
function noArgs(args: string[]): void { if (args.length) throw new ConfigError([`Unexpected arguments: ${args.join(" ")}`]); }

async function main(argv: string[]): Promise<void> {
  let root = process.cwd();
  if (argv[0] === "--project-directory") {
    if (!argv[1]) throw new ConfigError(["--project-directory requires a path."]);
    root = resolve(argv[1]); argv = argv.slice(2);
  }
  const command = argv[0] ?? "--help", args = argv.slice(1);
  if (["--help", "-h", "help"].includes(command)) { console.log(HELP); return; }
  if (["--version", "-V"].includes(command)) { console.log(VERSION); return; }
  const known = new Set(["init", "up", "down", "exec", "shell", "logs", "db", "npm", "pnpm", "config:test", "doctor", "build", "release"]);
  if (!known.has(command)) throw new ConfigError([`Unknown command ${command}. Run ship --help.`]);
  if (command === "init") {
    const opts = options(args, { database: { type: "string" }, cache: { type: "string" }, framework: { type: "string" },
      "package-manager": { type: "string" }, "package-manager-version": { type: "string" }, deployment: { type: "string" },
      "angular-project": { type: "string" }, "mongodb-mode": { type: "string" }, force: { type: "boolean" }, "no-interaction": { type: "boolean" } });
    await initProject(root, { ...(typeof opts.database === "string" ? { database: opts.database } : {}),
      ...(typeof opts.cache === "string" ? { cache: opts.cache } : {}), ...(typeof opts.framework === "string" ? { framework: opts.framework } : {}),
      ...(typeof opts["package-manager"] === "string" ? { packageManager: opts["package-manager"] } : {}),
      ...(typeof opts["package-manager-version"] === "string" ? { packageManagerVersion: opts["package-manager-version"] } : {}),
      ...(typeof opts.deployment === "string" ? { deployment: opts.deployment } : {}),
      ...(typeof opts["angular-project"] === "string" ? { angularProject: opts["angular-project"] } : {}),
      ...(typeof opts["mongodb-mode"] === "string" ? { mongodbMode: opts["mongodb-mode"] } : {}), force: opts.force === true });
    console.log("Initialized ship.json and ship/. Commit these files, then run ship up."); return;
  }
  const config = await loadProject(root);
  const app = config.serviceNames.app ?? "app";
  if (command === "config:test") {
    noArgs(args);
    buildCompose(config, root, "development");
    const model = buildCompose(config, root, "production");
    const problems = await productionProblems(model, root);
    if (problems.length) throw new ConfigError(problems);
    console.log("Configuration, project files and development/production models are valid."); return;
  }
  if (command === "build") { noArgs(args); await buildProduction(root, config, run); return; }
  if (command === "release") {
    const opts = options(args, { tag: { type: "string" } });
    if (typeof opts.tag !== "string") throw new ConfigError(["release requires --tag TAG."]);
    console.log(`Release written to ${await assembleRelease(root, config, opts.tag, run)}`); return;
  }
  const { prefix } = await composePrefix(root, config, "development", "local", { refreshApp: command === "up" });
  if (command === "up") {
    noArgs(args);
    await run([...prefix, "up", "--build", "-d", "--wait", "--wait-timeout", "180"], root);
    const port = await waitForStack(prefix, root, app, config.port, run);
    console.log(`Ready: http://127.0.0.1:${port}`); return;
  }
  if (command === "down") {
    const opts = options(args, { volumes: { type: "boolean" } });
    await run([...prefix, "down", ...(opts.volumes ? ["--volumes"] : [])], root); return;
  }
  if (command === "doctor") {
    noArgs(args);
    await run(["docker", "version"], root); await run(["docker", "compose", "version"], root);
    await run([...prefix, "ps", "--all"], root); return;
  }
  const exec = [...prefix, "exec", ...(!process.stdin.isTTY || !process.stdout.isTTY ? ["-T"] : [])];
  const applicationCommand = (target: string, argv: readonly string[]) => [...exec, target,
    ...(target === app ? ["node", "/usr/local/bin/ship-app-entrypoint.mjs"] : []), ...argv];
  if (command === "npm" || command === "pnpm") {
    if (command !== config.packageManager) throw new ConfigError([`This project selects ${config.packageManager}; use ship ${config.packageManager} to keep its lockfile authoritative.`]);
    await run(applicationCommand(app, [command, ...args]), root); return;
  }
  if (command === "exec") {
    if (args.length < 2 || args[0]!.startsWith("-")) throw new ConfigError(["Usage: ship exec SERVICE COMMAND [ARGUMENTS...]" ]);
    await run(applicationCommand(args[0]!, args.slice(1)), root); return;
  }
  if (command === "shell") {
    if (args.length > 1 || args[0]?.startsWith("-")) throw new ConfigError(["Usage: ship shell [SERVICE]"]);
    await run(applicationCommand(args[0] ?? app, ["sh"]), root); return;
  }
  if (command === "logs") {
    const values = parseArgs({ args, options: { follow: { type: "boolean", short: "f" } }, allowPositionals: true });
    if (values.positionals.length > 1) throw new ConfigError(["Usage: ship logs [SERVICE] [-f]"]);
    await run([...prefix, "logs", ...(values.values.follow ? ["-f"] : []), ...values.positionals], root); return;
  }
  if (command === "db") {
    if (args.length > 1 || args[0]?.startsWith("-")) throw new ConfigError(["Usage: ship db [INSTANCE]"]);
    const selected = selections(config, "development").find(s => s.definition.group === "database" &&
      (args[0] ? s.context.envPrefix === `${args[0].toUpperCase()}_` : s.context.envPrefix === ""));
    if (!selected?.definition.databaseShell) throw new ConfigError(["No matching database selected."]);
    await run([...exec, selected.context.serviceName, ...selected.definition.databaseShell(selected.context)], root);
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(`ship: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = error instanceof ProcessError ? error.exitCode : 1;
});
