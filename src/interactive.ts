import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { exists, parseConfig, readJson, readManifest } from "./config.js";
import { detectFramework, adapterFor } from "./adapters.js";
import { loadExtensions } from "./extensions.js";
import { DEFAULT_NPM_VERSION, EXACT_VERSION, manifestManager } from "./package-managers.js";
import { defaultDeployment } from "./framework-profiles.js";
import { applicationRoot, containedDirectory, workspacePackages } from "./workspaces.js";
import { planInitProject, type InitOptions } from "./init.js";
import { ConfigError, ProcessError } from "./errors.js";

export interface InitQuestion { key: string; label: string; defaultValue: string; choices?: readonly string[] }
export type AskInit = (question: InitQuestion) => Promise<string>;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, fallback = ""): string => typeof value === "string" ? value : fallback;
export const shouldPromptInit = (inputTTY: boolean, outputTTY: boolean, noInteraction: boolean, ci: string | undefined): boolean =>
  inputTTY && outputTTY && !noInteraction && (!ci || ci === "false" || ci === "0");

/** Collect choices without installing dependencies, invoking Docker or writing project files. */
export async function interactiveInitOptions(root: string, supplied: InitOptions, ask: AskInit, inform: (message: string) => void): Promise<InitOptions> {
  const options = { ...supplied };
  const choose = async (key: string, label: string, fallback: string, choices?: readonly string[], valid?: (value: string) => boolean): Promise<string> => {
    for (;;) {
      const answer = (await ask({ key, label, defaultValue: fallback, ...(choices ? { choices } : {}) })).trim() || fallback;
      if ((!choices || choices.includes(answer)) && (!valid || valid(answer))) return answer;
      inform(choices ? `Choose one of: ${choices.join(", ")}.` : "Enter a valid value.");
    }
  };
  const raw = await exists(resolve(root, "ship.json")) ? await readJson(resolve(root, "ship.json")) : {};
  if (!object(raw)) throw new ConfigError(["ship.json must contain an object."]);
  const rootManifest = await readManifest(root);
  const declared = manifestManager(rootManifest);
  const existingWorkspace = object(raw.workspace) ? text(raw.workspace.app) : "";
  if (options.workspace === undefined && (rootManifest.workspaces || existingWorkspace || await exists(resolve(root, "pnpm-workspace.yaml")))) {
    const manager = declared?.name ?? (raw.packageManager === "pnpm" || await exists(resolve(root, "pnpm-workspace.yaml")) ? "pnpm" : "npm");
    const packages = await workspacePackages(root, manager, rootManifest);
    if (!packages.length) throw new ConfigError(["No workspace packages were found; check the root workspace patterns and package.json files."]);
    options.workspace = await choose("workspace", "Workspace app path (--workspace)", existingWorkspace || packages[0]!, packages);
  }
  const workspace = parseConfig({ workspace: options.workspace === undefined ? raw.workspace ?? null : { app: options.workspace } }, root).workspace;
  const appRoot = applicationRoot({ workspace }, root);
  if (workspace) await containedDirectory(root, appRoot);
  const manifest = workspace ? await readManifest(appRoot) : rootManifest;
  const registry = await loadExtensions(root, parseConfig({ extensions: raw.extensions }, root).extensions);
  const changedWorkspace = options.workspace !== undefined && options.workspace !== existingWorkspace;
  if (options.framework === undefined) options.framework = await choose("framework", "Framework (--framework)",
    (!changedWorkspace ? text(raw.framework) : "") || detectFramework(manifest), [...registry.adapters.keys()]);
  const adapter = adapterFor({ framework: options.framework }, registry);
  const inferred = adapter.defaultDeployment ?? defaultDeployment(options.framework);
  const sameFramework = !changedWorkspace && (raw.framework === undefined || raw.framework === options.framework);
  const modes = ["react", "vue", "svelte", "vitepress", "gatsby"].includes(options.framework) ? ["static"]
    : ["generic", "expressjs", "fastify", "nestjs", "tanstack-start"].includes(options.framework) ? ["node"] : ["node", "static"];
  if (options.deployment === undefined) options.deployment = await choose("deployment", "Deployment (--deployment)", sameFramework ? text(raw.deployment, inferred) : inferred, modes);
  if (options.framework === "angular" && options.angularProject === undefined) {
    const angular = await readJson(resolve(appRoot, "angular.json"));
    const projects = object(angular) && object(angular.projects) ? Object.entries(angular.projects)
      .filter(([, value]) => object(value) && value.projectType === "application").map(([key]) => key) : [];
    if (!projects.length) throw new ConfigError(["angular.json has no application projects."]);
    options.angularProject = await choose("angularProject", "Angular application (--angular-project)", text(raw.angularProject, projects[0]!), projects);
  }
  if (options.packageManager === undefined) options.packageManager = await choose("packageManager", "Package manager (--package-manager)",
    text(raw.packageManager) || declared?.name || (await exists(resolve(root, "pnpm-lock.yaml")) ? "pnpm" : "npm"), ["npm", "pnpm"]);
  if (options.packageManagerVersion === undefined) options.packageManagerVersion = await choose("packageManagerVersion", "Exact package-manager version (--package-manager-version)",
    (raw.packageManager === options.packageManager ? text(raw.packageManagerVersion) : "") ||
    (declared?.name === options.packageManager ? declared.version : options.packageManager === "npm" ? DEFAULT_NPM_VERSION : ""), undefined,
    value => EXACT_VERSION.test(value));
  const services = object(raw.services) ? raw.services : {};
  for (const group of ["database", "cache"] as const) if (options[group] === undefined) {
    options[group] = await choose(group, `${group === "database" ? "Database" : "Cache"} (--${group})`, text(services[group], "none"),
      ["none", ...[...registry.services.values()].filter(service => service.group === group).map(service => service.key)]);
  }
  if (options.mongodbMode === undefined && (options.database === "mongodb" || (Array.isArray(raw.additionalServices) && raw.additionalServices.some(s => object(s) && s.service === "mongodb")))) {
    options.mongodbMode = await choose("mongodbMode", "MongoDB mode (--mongodb-mode)", text(raw.mongodbMode, "replica-set"), ["replica-set", "standalone"]);
  }
  const { config } = await planInitProject(root, options, registry);
  inform(`Plan: ${config.framework}/${config.deployment}; ${config.packageManager}@${config.packageManagerVersion}; app ${config.workspace?.app ?? "."}; database ${config.services.database ?? "none"}; cache ${config.services.cache ?? "none"}.`);
  inform(options.force ? "--force will replace generated templates, including edited templates." : "Edited templates are preserved; --force is required to replace them.");
  if (await choose("confirm", "Write ship.json and generated files?", "no", ["yes", "no"]) !== "yes") throw new ProcessError("Initialization cancelled; no files written.", 130);
  return options;
}

export function terminalInitPrompter(): { ask: AskInit; close: () => void } {
  const terminal = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const lines = terminal[Symbol.asyncIterator]();
  let interrupted = false;
  terminal.on("SIGINT", () => { interrupted = true; terminal.close(); });
  return {
    ask: async question => {
      const choices = question.choices ? ` (${question.choices.join("/")})` : "";
      process.stdout.write(`${question.label}${choices}${question.defaultValue ? ` [${question.defaultValue}]` : ""}: `);
      const line = await lines.next();
      if (line.done) throw new ProcessError(interrupted ? "Initialization cancelled; no files written." : "Input closed; initialization cancelled without writing files.", interrupted ? 130 : 1);
      return line.value;
    },
    close: () => terminal.close(),
  };
}
