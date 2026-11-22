import { readFile } from "node:fs/promises";
import { renderTemplates } from "./templates.js";
import { resolveWorkspace } from "./workspaces.js";
import { resolve } from "node:path";
import { exists, parseConfig, projectName, readJson, readManifest } from "./config.js";
import { detectFramework, adapterFor } from "./adapters.js";
import { loadExtensions } from "./extensions.js";
import { DEFAULT_NPM_VERSION, EXACT_VERSION, manifestManager } from "./package-managers.js";
import { defaultDeployment } from "./framework-profiles.js";
import { applicationRoot, containedDirectory, workspacePackages } from "./workspaces.js";
import { planInitProject, type InitOptions } from "./init.js";
import { NAME, NETWORK_NAME, RESERVED } from "./config-rules.js";
import { scriptProcessSuggestions } from "./adapter-capabilities.js";
import { runWizard } from "./wizard.js";
import { ConfigError, ProcessError } from "./errors.js";

export interface InitQuestion { key: string; label: string; defaultValue: string; choices?: readonly string[]; multiple?: boolean; validate?: (value: string) => boolean }
export type AskInit = (question: InitQuestion) => Promise<string>;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, fallback = ""): string => typeof value === "string" ? value : fallback;
export const shouldPromptInit = (inputTTY: boolean, outputTTY: boolean, noInteraction: boolean, ci: string | undefined): boolean =>
  inputTTY && outputTTY && !noInteraction && (!ci || ci === "false" || ci === "0");

/** Collect choices without installing dependencies, invoking Docker or writing project files. */
export async function interactiveInitOptions(root: string, supplied: InitOptions, ask: AskInit, inform: (message: string) => void): Promise<InitOptions> {
  return runWizard(prompt => collectInitOptions(root, supplied, prompt, inform), ask);
}
async function collectInitOptions(root: string, supplied: InitOptions, ask: AskInit, inform: (message: string) => void): Promise<InitOptions> {
  const options = { ...supplied };
  const choose = async (key: string, label: string, fallback: string, choices?: readonly string[], valid?: (value: string) => boolean): Promise<string> => {
    for (;;) {
      const answer = (await ask({ key, label, defaultValue: fallback, ...(choices ? { choices } : {}), ...(valid ? { validate: valid } : {}) })).trim() || fallback;
      if ((!choices || choices.includes(answer)) && (!valid || valid(answer))) return answer;
      inform(choices ? `Choose one of: ${choices.join(", ")}.` : "Enter a valid value.");
    }
  };
  const raw = await exists(resolve(root, "ship.json")) ? await readJson(resolve(root, "ship.json")) : {};
  if (!object(raw)) throw new ConfigError(["ship.json must contain an object."]);
  if (Object.keys(raw).length) parseConfig(raw, root);
  if (options.name === undefined) options.name = await choose("name", "Application name (keep stable to preserve production volumes)", text(raw.name, projectName(root)), undefined, value => NAME.test(value));
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
    text(raw.packageManager) || declared?.name || (await exists(resolve(root, "pnpm-lock.yaml")) ? "pnpm" : await exists(resolve(root, "yarn.lock")) ? "yarn" : "npm"), ["npm", "pnpm", "yarn"]);
  if (options.packageManagerVersion === undefined) options.packageManagerVersion = await choose("packageManagerVersion", "Exact package-manager version (--package-manager-version)",
    (raw.packageManager === options.packageManager ? text(raw.packageManagerVersion) : "") ||
    (declared?.name === options.packageManager ? declared.version : options.packageManager === "npm" ? DEFAULT_NPM_VERSION : ""), undefined,
    value => EXACT_VERSION.test(value));
  const existingServices = object(raw.services) ? raw.services as Record<string, string> : {};
  const groups = [...new Set([...registry.services.values()].map(s => s.group))];
  const availableGroups = groups.filter(group => !Object.hasOwn(supplied.services ?? {}, group) && !((group === "database" || group === "cache") && supplied[group] !== undefined));
  const categories = await ask({ key: "serviceGroups", label: "Service categories (space to select)", defaultValue: availableGroups.filter(g => existingServices[g]).join(",") || "none", choices: availableGroups, multiple: true });
  const selectedGroups = categories === "none" || !categories ? [] : categories.split(",").map(v => v.trim());
  if (selectedGroups.some(g => !availableGroups.includes(g))) throw new ConfigError(["Unknown service category."]);
  options.services = { ...(options.services ?? existingServices) };
  for (const group of availableGroups) {
    if (!selectedGroups.includes(group)) { delete options.services[group]; continue; }
    const choices = [...registry.services.values()].filter(service => service.group === group).map(service => service.key);
    options.services[group] = await choose(group, `${group} provider`, existingServices[group] ?? choices[0]!, choices);
  }
  // Keep database/cache flags authoritative, including their legacy prompt keys.
  for (const group of ["database", "cache"] as const) if (supplied[group] !== undefined) options[group] = supplied[group];
  if (options.database === undefined) options.database = options.services.database ?? "none";
  if (options.cache === undefined) options.cache = options.services.cache ?? "none";
  const additional = Array.isArray(raw.additionalServices) ? raw.additionalServices as import("./contracts.js").AdditionalService[] : [];
  if (supplied.additionalServices !== undefined) options.additionalServices = [...supplied.additionalServices];
  else {
  options.additionalServices = [];
  if (additional.length) {
    const keep = await ask({ key: "keepInstances", label: "Keep named instances", choices: additional.map(s => s.name), defaultValue: additional.map(s => s.name).join(","), multiple: true });
    options.additionalServices = additional.filter(s => keep.split(",").includes(s.name));
  }
  while (await choose(`addInstance${options.additionalServices.length}`, "Add a named service instance?", "no", ["yes", "no"]) === "yes") {
    const i = options.additionalServices.length;
    const group = await choose(`instanceGroup${i}`, "Instance category", "database", groups);
    const choices = [...registry.services.values()].filter(s => s.group === group).map(s => s.key);
    const service = await choose(`instanceService${i}`, "Instance provider", choices[0]!, choices);
    const name = await choose(`instanceName${i}`, "Instance name (environment prefix)", "", undefined, v => /^[a-z][a-z0-9_]*$/.test(v) && !options.additionalServices!.some(s => s.name === v));
    options.additionalServices.push({ group, service, name });
  }
  }
  if (options.node === undefined) options.node = await choose("node", "Container Node.js major", text(raw.node, "24"), ["22", "24", "26"]);
  if (options.siloImage === undefined && (options.services.storage === "silo" || options.additionalServices.some(s => s.service === "silo"))) options.siloImage = await choose("siloImage", "Silo image variant", text(raw.siloImage, "standard"), ["standard", "distroless"]);
  if (options.externalNetwork === undefined) {
    const previous = Array.isArray(raw.externalNetwork) ? raw.externalNetwork.join(",") : text(raw.externalNetwork);
    const networks = await choose("externalNetwork", "External networks (comma-separated; none to clear)", previous || "none", undefined, v => v === "none" || v.split(",").every(n => NETWORK_NAME.test(n.trim())));
    options.externalNetwork = networks === "none" ? null : [...new Set(networks.split(",").map(v => v.trim()))];
  }
  options.processes = options.processes ?? (object(raw.processes) ? raw.processes as import("./contracts.js").ShipConfig["processes"] : {});
  if (options.deployment === "node") {
    if (Object.keys(options.processes).length && supplied.processes === undefined) {
      const retained = await ask({ key: "keepProcesses", label: "Keep production processes", defaultValue: Object.keys(options.processes).join(","), choices: Object.keys(options.processes), multiple: true });
      options.processes = Object.fromEntries(Object.entries(options.processes).filter(([name]) => retained.split(",").includes(name)));
    }
    const suggestionConfig = parseConfig({ ...raw, framework: options.framework, deployment: options.deployment, packageManager: options.packageManager, packageManagerVersion: options.packageManagerVersion }, root);
    const suggestions = adapter.suggestProcesses?.(suggestionConfig, manifest) ?? scriptProcessSuggestions(suggestionConfig, manifest);
    for (const [name, suggestion] of Object.entries(suggestions)) {
      if (!Object.hasOwn(options.processes, name) && await choose(`process-${name}`, `Add production process: ${suggestion.label}?`, "no", ["yes", "no"]) === "yes") options.processes = { ...options.processes, [name]: suggestion.definition };
    }
    while (await choose(`addProcess${Object.keys(options.processes).length}`, "Add a custom production process?", "no", ["yes", "no"]) === "yes") {
      const n = Object.keys(options.processes).length;
      const name = await choose(`processName${n}`, "Process name", "", undefined, v => NAME.test(v) && !RESERVED.has(v) && !Object.hasOwn(options.processes!, v));
      const command = await choose(`processCommand${n}`, "Process shell command", "", undefined, v => !!v.trim());
      const port = await choose(`processPort${n}`, "HTTP port (none for a worker)", "none", undefined, v => v === "none" || /^\d+$/.test(v) && Number(v) > 0 && Number(v) <= 65535);
      const healthcheck = await choose(`processCheck${n}`, "Health command (none when unknown)", "none");
      let http: import("./contracts.js").HttpEndpoint | undefined;
      if (port !== "none") {
        const role = await choose(`processRole${n}`, "HTTP role", "site", ["site", "websocket", "dashboard"]);
        const health = await choose(`processHealth${n}`, "HTTP healthy path (none when unknown)", "none", undefined, v => v === "none" || v.startsWith("/"));
        const urlSetting = await choose(`processUrl${n}`, "Public URL setting name (none when unknown)", "none", undefined, v => v === "none" || /^[A-Za-z_][A-Za-z0-9_]*$/.test(v));
        http = { port: Number(port), role, health: health === "none" ? null : health, urlSetting: urlSetting === "none" ? null : urlSetting };
      }
      options.processes = { ...options.processes, [name]: { command, ...(http ? { http } : {}), ...(healthcheck === "none" ? {} : { healthcheck }) } };
    }
  }
  if (options.mongodbMode === undefined && (options.database === "mongodb" || (Array.isArray(raw.additionalServices) && raw.additionalServices.some(s => object(s) && s.service === "mongodb")))) {
    options.mongodbMode = await choose("mongodbMode", "MongoDB mode (--mongodb-mode)", text(raw.mongodbMode, "replica-set"), ["replica-set", "standalone"]);
  }
  const { config } = await planInitProject(root, options, registry);
  inform(`Plan: name ${config.name}; Node ${config.node}; ${Object.entries(config.services).map(([g, s]) => `${g}=${s}`).join(", ")}; instances ${config.additionalServices.map(s => s.name).join(", ") || "none"}; processes ${Object.keys(config.processes).join(", ") || "none"}; networks ${JSON.stringify(config.externalNetwork)}; ${config.framework}/${config.deployment}; ${config.packageManager}@${config.packageManagerVersion}; app ${config.workspace?.app ?? "."}; database ${config.services.database ?? "none"}; cache ${config.services.cache ?? "none"}.`);
  const templates = await renderTemplates(config, await resolveWorkspace(config, root), registry);
  const changes: string[] = ["ship.json", ".dockerignore", ".gitignore", ".env / environment examples (missing keys only)"];
  for (const [name, content] of Object.entries(templates)) {
    const path = resolve(root, "ship", name);
    if (!await exists(path)) changes.push(`create ship/${name}`);
    else if (await readFile(path, "utf8") !== content) changes.push(`${options.force || name === "ship.schema.json" ? "update" : "preserve edited"} ship/${name}`);
  }
  inform(`Files: ${changes.join("; ")}.`);
  inform(options.force ? "--force will replace generated templates, including edited templates." : "Edited templates are preserved; --force is required to replace them.");
  if (await choose("confirm", "Write ship.json and generated files?", "no", ["yes", "no"]) !== "yes") throw new ProcessError("Initialization cancelled; no files written.", 130);
  return options;
}

export { terminalInitPrompter } from "./terminal-prompts.js";
