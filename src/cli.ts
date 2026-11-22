#!/usr/bin/env node
import { mutagenEnabled, requireMutagen, startSync, stopSync } from "./sync.js";
import { switchPackageManager } from "./switch-manager.js";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { interactiveInitOptions, shouldPromptInit, terminalInitPrompter } from "./interactive.js";
import { diagnoseProject, formatDoctor } from "./doctor.js";
import { initProject, type InitOptions } from "./init.js";
import { exists, parseConfig, readJson, readConfig, readManifest } from "./config.js";
import { loadExtensions } from "./extensions.js";
import { composePrefix, loadProject } from "./project.js";
import { buildProjectCompose, selections } from "./compose.js";
import { adapterProductionProblems, productionProblems, productionWarnings } from "./production.js";
import { assembleRelease, buildProduction, VERSION } from "./release.js";
import { run } from "./process.js";
import { ConfigError, ProcessError } from "./errors.js";
import { buildContextProblems, buildSecretProblems } from "./build-environment.js";
import { scriptCommand } from "./package-managers.js";
import { applicationRoot } from "./workspaces.js";
import { NODE_MINIMUMS } from "./images.js";
import { nodeRuntimeProblem } from "./runtime-version.js";
import { waitForStack } from "./runtime.js";

const HELP = `JavaScript Ship ${VERSION} — development milestone

Usage: ship [--project-directory PATH] COMMAND [arguments]

  init [--database PROVIDER|none] [--cache PROVIDER|none] [--force]
       [--framework NAME] [--package-manager npm|pnpm|yarn]
       [--package-manager-version VERSION] [--no-interaction]
       [--deployment node|static] [--angular-project NAME]
       [--mongodb-mode standalone|replica-set] [--workspace PATH]
       [--name NAME] [--node MAJOR] [--service GROUP=PROVIDER ...]
       [--additional-service GROUP=PROVIDER:NAME ...] [--remove-instance NAME ...]
       [--process NAME=COMMAND ...] [--process-definition NAME=JSON ...]
       [--network NAME ... | --no-network]
       [--deploy-command COMMAND ...] [--silo-image standard|distroless] [--no-host-user]
  package-manager TOOL[@VERSION] [--yes] [--force]  Switch/update in the running app
  test [-- ARGUMENTS...]     Run the selected browser test tool (after ship up)
  up                         Build, start, wait for services and HTTP
  down [--volumes]            Stop; --volumes also deletes persisted data
  exec SERVICE COMMAND...    Execute in a running container
  shell [SERVICE]            Open sh (defaults to app)
  logs [SERVICE] [-f]         Show container logs
  db [INSTANCE]              Open the selected database client
  npm ARGUMENTS...           Run npm inside app (arguments passed unchanged)
  pnpm ARGUMENTS...           Run pnpm inside a pnpm app
  yarn ARGUMENTS...           Run Yarn inside a Yarn app
  config:test                Check project and both Compose models, no Docker
  doctor [--json]            Diagnose project/Docker/service issues with recovery hints
  build [--no-cache]         Build project-owned production images
  release --tag TAG [--no-env] [--force] Export a Docker-only release under dist/ship/TAG

Adapters: generic, react, vue, angular, svelte, nestjs, fastify, expressjs,
          next, nuxt, sveltekit, astro, vitepress, tanstack-start, gatsby.
Package managers: pinned npm, pnpm and Yarn 4 (node_modules). 22 infrastructure and testing services; see docs/services.md.
Init prompts in terminals; --no-interaction skips all questions.
Deployment modes and verification status are documented in docs/frameworks.md.
`;

function options(args: string[], definitions: Record<string, { type: "string" | "boolean"; multiple?: boolean }>): Record<string, string | string[] | boolean | undefined> {
  return parseArgs({ args, options: definitions, strict: true, allowPositionals: false }).values as Record<string, string | string[] | boolean | undefined>;
}
function noArgs(args: string[]): void { if (args.length) throw new ConfigError([`Unexpected arguments: ${args.join(" ")}`]); }

async function main(argv: string[]): Promise<void> {
  const runtimeProblem = nodeRuntimeProblem(process.versions.node, NODE_MINIMUMS);
  if (runtimeProblem) throw new ConfigError([runtimeProblem]);
  let root = process.cwd();
  if (argv[0] === "--project-directory") {
    if (!argv[1]) throw new ConfigError(["--project-directory requires a path."]);
    root = resolve(argv[1]); argv = argv.slice(2);
  }
  const command = argv[0] ?? "--help", args = argv.slice(1);
  if (["--help", "-h", "help"].includes(command)) { console.log(HELP); return; }
  if (["--version", "-V"].includes(command)) { console.log(VERSION); return; }
  const known = new Set(["init", "up", "down", "exec", "shell", "logs", "db", "npm", "pnpm", "yarn", "config:test", "doctor", "build", "release", "test", "package-manager"]);
  if (!known.has(command)) throw new ConfigError([`Unknown command ${command}. Run ship --help.`]);
  if (args.length === 1 && ["--help", "-h"].includes(args[0]!) && !["npm", "pnpm", "yarn"].includes(command)) {
    console.log(HELP); return;
  }
  if (command === "init") {
    const opts = options(args, { database: { type: "string" }, cache: { type: "string" }, framework: { type: "string" },
      "package-manager": { type: "string" }, "package-manager-version": { type: "string" }, deployment: { type: "string" },
      "angular-project": { type: "string" }, "mongodb-mode": { type: "string" }, workspace: { type: "string" }, name: { type: "string" }, node: { type: "string" }, "silo-image": { type: "string" }, "no-host-user": { type: "boolean" },
      service: { type: "string", multiple: true }, "additional-service": { type: "string", multiple: true }, "remove-instance": { type: "string", multiple: true }, "process-definition": { type: "string", multiple: true }, "no-network": { type: "boolean" }, process: { type: "string", multiple: true }, network: { type: "string", multiple: true }, "deploy-command": { type: "string", multiple: true }, force: { type: "boolean" }, "no-interaction": { type: "boolean" } });
    let initOptions: InitOptions = { ...(typeof opts.database === "string" ? { database: opts.database } : {}),
      ...(typeof opts.cache === "string" ? { cache: opts.cache } : {}), ...(typeof opts.framework === "string" ? { framework: opts.framework } : {}),
      ...(typeof opts["package-manager"] === "string" ? { packageManager: opts["package-manager"] } : {}),
      ...(typeof opts["package-manager-version"] === "string" ? { packageManagerVersion: opts["package-manager-version"] } : {}),
      ...(typeof opts.deployment === "string" ? { deployment: opts.deployment } : {}),
      ...(typeof opts["angular-project"] === "string" ? { angularProject: opts["angular-project"] } : {}),
      ...(typeof opts["mongodb-mode"] === "string" ? { mongodbMode: opts["mongodb-mode"] } : {}), ...(typeof opts.workspace === "string" ? { workspace: opts.workspace } : {}), force: opts.force === true };
    for (const key of ["name", "node"] as const) if (typeof opts[key] === "string") initOptions[key] = opts[key];
    if (typeof opts["silo-image"] === "string") initOptions.siloImage = opts["silo-image"];
    if (opts["no-host-user"] === true) initOptions.hostUser = false;
    const pairs = (value: unknown, label: string): Record<string, string> => Object.fromEntries((Array.isArray(value) ? value : []).map((entry: string) => {
      const index = entry.indexOf("=");
      if (index < 1 || index === entry.length - 1) throw new ConfigError([`${label} requires NAME=VALUE.`]);
      return [entry.slice(0, index), entry.slice(index + 1)];
    }));
    if (opts.service) initOptions.services = { ...parseConfig(await exists(resolve(root, "ship.json")) ? await readJson(resolve(root, "ship.json")) : {}, root).services, ...pairs(opts.service, "--service") };
    const current = parseConfig(await exists(resolve(root, "ship.json")) ? await readJson(resolve(root, "ship.json")) : {}, root);
    if (opts.process) initOptions.processes = { ...current.processes, ...pairs(opts.process, "--process") };
    if (opts["process-definition"]) {
      const definitions = pairs(opts["process-definition"], "--process-definition");
      try { initOptions.processes = { ...current.processes, ...initOptions.processes, ...Object.fromEntries(Object.entries(definitions).map(([name, value]) => [name, JSON.parse(value) as import("./contracts.js").ProcessConfig])) }; }
      catch { throw new ConfigError(["--process-definition requires NAME=JSON with a command/health/http definition."]); }
    }
    if (opts["additional-service"] || opts["remove-instance"]) {
      const additions = (Array.isArray(opts["additional-service"]) ? opts["additional-service"] : []).flatMap(value => Object.entries(pairs([value], "--additional-service"))).map(([group, value]) => {
        const [service, name, extra] = value.split(":");
        if (!service || !name || extra) throw new ConfigError(["--additional-service requires GROUP=PROVIDER:NAME."]);
        return { group, service, name };
      });
      const removed = Array.isArray(opts["remove-instance"]) ? opts["remove-instance"] : [];
      initOptions.additionalServices = [...current.additionalServices.filter(s => !removed.includes(s.name)), ...additions];
    }
    if (opts["no-network"] === true) initOptions.externalNetwork = null;
    if (Array.isArray(opts.network)) initOptions.externalNetwork = opts.network;
    if (Array.isArray(opts["deploy-command"])) initOptions.deployCommands = opts["deploy-command"];
    if (shouldPromptInit(!!process.stdin.isTTY, !!process.stdout.isTTY, opts["no-interaction"] === true, process.env.CI)) {
      const terminal = await terminalInitPrompter();
      try { initOptions = await interactiveInitOptions(root, initOptions, terminal.ask, terminal.inform); }
      finally { terminal.close(); }
    }
    await initProject(root, initOptions);
    console.log("Initialized ship.json and ship/. Commit these files, then run ship up."); return;
  }
  if (command === "doctor") {
    const opts = options(args, { json: { type: "boolean" } });
    const report = await diagnoseProject(root, run);
    console.log(opts.json ? JSON.stringify(report, null, 2) : formatDoctor(report));
    if (!report.ok) process.exitCode = 1;
    return;
  }
  if (command === "package-manager") {
    const parsed = parseArgs({ args, options: { yes: { type: "boolean" }, force: { type: "boolean" } }, allowPositionals: true, strict: true });
    if (parsed.positionals.length !== 1) throw new ConfigError(["Usage: ship package-manager npm|pnpm|yarn[@EXACT_VERSION] [--yes] [--force]"]);
    const canPrompt = shouldPromptInit(!!process.stdin.isTTY, !!process.stdout.isTTY, false, process.env.CI);
    await switchPackageManager(root, parsed.positionals[0]!, run, { yes: parsed.values.yes === true, force: parsed.values.force === true,
      ...(canPrompt ? { confirm: async (message: string) => { const terminal = await terminalInitPrompter(); try { return await terminal.ask({ key: "switch", label: message, defaultValue: "no", choices: ["yes", "no"] }) === "yes"; } finally { terminal.close(); } } } : {}) });
    console.log("Package manager updated. Review and commit the manifest/lockfile changes, then run ship up to rebuild the development image."); return;
  }
  const registry = await loadExtensions(root, (await readConfig(root)).extensions);
  const config = await loadProject(root, registry);
  const app = config.serviceNames.app ?? "app";
  if (command === "config:test") {
    noArgs(args);
    await buildProjectCompose(config, root, "development", "local", registry);
    const model = await buildProjectCompose(config, root, "production", "local", registry);
    const problems = [...await adapterProductionProblems(config, root, registry), ...await productionProblems(model, root), ...await buildContextProblems(root), ...await buildSecretProblems(config, root)];
    if (problems.length) throw new ConfigError(problems);
    for (const warning of await productionWarnings(config, root)) console.warn(`ship: ${warning}`);
    console.log("Configuration, project files and development/production models are valid."); return;
  }
  if (command === "build") {
    const opts = options(args, { "no-cache": { type: "boolean" } });
    await buildProduction(root, config, run, "local", { noCache: opts["no-cache"] === true, registry }); return;
  }
  if (command === "release") {
    const opts = options(args, { tag: { type: "string" }, "no-env": { type: "boolean" }, force: { type: "boolean" } });
    if (typeof opts.tag !== "string" && shouldPromptInit(!!process.stdin.isTTY, !!process.stdout.isTTY, false, process.env.CI)) {
      const terminal = await terminalInitPrompter();
      try { opts.tag = await terminal.ask({ key: "tag", label: "Release tag", defaultValue: "" }); } finally { terminal.close(); }
    }
    if (typeof opts.tag !== "string") throw new ConfigError(["release requires --tag TAG."]);
    console.log(`Release written to ${await assembleRelease(root, config, opts.tag, run, registry, { noEnv: opts["no-env"] === true, force: opts.force === true })}`); return;
  }
  const { prefix } = await composePrefix(root, config, "development", "local", { refreshApp: command === "up", registry });
  if (command === "up") {
    noArgs(args);
    const problems = [...await buildContextProblems(root), ...await buildSecretProblems(config, root, true)];
    if (problems.length) throw new ConfigError(problems);
    if (mutagenEnabled()) await requireMutagen(root, run);
    await run([...prefix, "up", "--build", "-d", "--wait", "--wait-timeout", "180"], root);
    if (mutagenEnabled()) await startSync(prefix, root, app, run);
    const port = await waitForStack(prefix, root, app, config.port, run);
    console.log(`Ready: http://127.0.0.1:${port}`); return;
  }
  if (command === "down") {
    const opts = options(args, { volumes: { type: "boolean" } });
    await stopSync(root, run);
    await run([...prefix, "down", ...(opts.volumes ? ["--volumes"] : [])], root); return;
  }
  const exec = [...prefix, "exec", ...(!process.stdin.isTTY || !process.stdout.isTTY ? ["-T"] : [])];
  const applicationCommand = (target: string, argv: readonly string[]) => [...exec, target,
    ...(target === app ? ["node", "/usr/local/bin/ship-app-entrypoint.mjs"] : []), ...argv];
  if (command === "test") {
    const tool = selections(config, "development", root, registry).find(s => s.definition.group === "testing" && !s.context.envPrefix);
    if (!tool) throw new ConfigError(["Select a testing service with ship init or run your package's test script with ship npm/pnpm/yarn."]);
    const forwarded = args[0] === "--" ? args.slice(1) : args;
    if (tool.definition.key === "cypress") await run([...prefix, "run", "--rm", "--no-deps", ...(!process.stdin.isTTY ? ["-T"] : []), "--entrypoint", "sh", tool.context.serviceName, "-c", 'set -eu; if [ ! -e /e2e/node_modules/cypress ]; then ln -s /usr/local/lib/node_modules/cypress /e2e/node_modules/cypress; fi; exec cypress run "$@"', "ship-cypress", ...forwarded], root);
    else if (tool.definition.key === "playwright") await run(applicationCommand(app, [config.packageManager, "exec", ...(config.packageManager === "npm" ? ["--"] : []), "playwright", "test", ...forwarded]), root);
    else {
      const manifest = await readManifest(applicationRoot(config, root));
      if (!manifest.scripts?.["test:e2e"]) throw new ConfigError(["For Selenium, define a test:e2e package script using selenium-webdriver or WebdriverIO and SELENIUM_REMOTE_URL."]);
      await run(applicationCommand(app, scriptCommand(config, "test:e2e", forwarded)), root);
    }
    return;
  }
  if (command === "npm" || command === "pnpm" || command === "yarn") {
    if (command !== config.packageManager) throw new ConfigError([`This project selects ${config.packageManager}; use ship ${config.packageManager} to keep its lockfile authoritative.`]);
    await run(applicationCommand(app, [...(config.build.npmrc ? ["env", "NPM_CONFIG_USERCONFIG=/run/secrets/ship_npmrc"] : []), command, ...args]), root); return;
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
    const selected = selections(config, "development", root, registry).find(s => s.definition.group === "database" &&
      (args[0] ? s.context.envPrefix === `${args[0].toUpperCase()}_` : s.context.envPrefix === ""));
    if (!selected?.definition.databaseShell) throw new ConfigError(["No matching database selected."]);
    await run([...exec, selected.context.serviceName, ...selected.definition.databaseShell(selected.context)], root);
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(`ship: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = error instanceof ProcessError ? error.exitCode : 1;
});
