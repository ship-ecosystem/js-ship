import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { exists, parseConfig, readJson, readManifest } from "./config.js";
import { ConfigError } from "./errors.js";
import { adapterFor, detectFramework } from "./adapters.js";
import { buildCompose } from "./compose.js";
import type { ShipConfig } from "./contracts.js";
import { DEFAULT_NPM_VERSION, detectPackageManager, EXACT_VERSION, manifestManager, packageManagerProblems } from "./package-managers.js";
import { renderTemplates, templateProblems } from "./templates.js";
import { angularSettings } from "./angular.js";
import { defaultDeployment } from "./framework-profiles.js";

export interface InitOptions { force?: boolean; database?: string; cache?: string; framework?: string; packageManager?: string; packageManagerVersion?: string; deployment?: string; angularProject?: string; mongodbMode?: string }
export async function projectProblems(config: ShipConfig, root: string): Promise<string[]> {
  const manifest = await readManifest(root);
  const problems = adapterFor(config).validate(config, manifest);
  if (adapterFor(config).packaging(config).kind === "static" && config.serverEntry !== null) problems.push("serverEntry applies only to Node deployment.");
  problems.push(...await packageManagerProblems(config, manifest, root));
  if (config.framework === "angular") {
    const expected = await angularSettings(root, config.angularProject, config.deployment);
    if (config.outputDirectory !== expected.outputDirectory || config.serverEntry !== expected.serverEntry) problems.push("Angular output paths differ from angular.json production settings. Update ship.json or run ship init --force.");
  }
  return problems;
}

async function appendRules(path: string, rules: readonly string[]): Promise<void> {
  const current = await exists(path) ? await readFile(path, "utf8") : "";
  const lines = new Set(current.split(/\r?\n/));
  const missing = rules.filter(rule => !lines.has(rule));
  if (missing.length) await writeFile(path, `${current}${current && !current.endsWith("\n") ? "\n" : ""}\n# JavaScript Ship\n${missing.join("\n")}\n`);
}

export async function initProject(root: string, options: InitOptions = {}): Promise<ShipConfig> {
  const manifest = await readManifest(root);
  const path = resolve(root, "ship.json");
  const raw = await exists(path) ? await readJson(path) : {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ConfigError(["ship.json must contain an object."]);
  const existing = raw as Record<string, unknown>;
  const framework = options.framework ?? existing.framework ?? detectFramework(manifest);
  if (typeof framework !== "string") throw new ConfigError(["framework must be a string."]);
  const changedFramework = options.framework !== undefined && existing.framework !== undefined && options.framework !== existing.framework;
  const deployment = options.deployment ?? (changedFramework ? defaultDeployment(framework) : existing.deployment) ?? defaultDeployment(framework);
  if (deployment !== "node" && deployment !== "static") throw new ConfigError(["deployment must be node or static."]);
  const defaults = { ...adapterFor({ framework }).defaults(manifest, deployment),
    ...(framework === "angular" ? await angularSettings(root, options.angularProject ?? existing.angularProject, deployment) : {}) };
  const declared = manifestManager(manifest);
  const managerName = options.packageManager ?? existing.packageManager ?? declared?.name;
  const managerVersion = options.packageManagerVersion ?? existing.packageManagerVersion ??
    (declared && declared.name === managerName ? declared.version : managerName === "npm" ? DEFAULT_NPM_VERSION : undefined);
  const detected = managerName === undefined ? await detectPackageManager(root, manifest) : null;
  if (managerName !== undefined && managerName !== "npm" && managerName !== "pnpm") throw new ConfigError(["--package-manager must be npm or pnpm."]);
  if (managerName === "pnpm" && (typeof managerVersion !== "string" || !EXACT_VERSION.test(managerVersion))) throw new ConfigError(["Pin pnpm with package.json packageManager or --package-manager-version VERSION."]);
  const services = { ...((existing.services ?? {}) as Record<string, string>) };
  for (const key of ["database", "cache"] as const) {
    const value = options[key];
    if (value === "none") delete services[key];
    else if (value !== undefined) services[key] = value;
  }
  const switching = changedFramework ||
    (options.deployment !== undefined && options.deployment !== (existing.deployment ?? defaultDeployment(framework))) ||
    (options.angularProject !== undefined && existing.angularProject !== undefined && options.angularProject !== existing.angularProject);
  const data = { ...defaults, ...existing, framework, services,
    ...(switching || (options.force && framework === "angular") ? defaults : {}), deployment,
    ...(switching && framework !== "angular" ? { serverEntry: null } : {}),
    ...(options.mongodbMode ? { mongodbMode: options.mongodbMode } : {}),
    packageManager: managerName ?? detected!.name, packageManagerVersion: managerVersion ?? detected?.version,
    scripts: switching ? defaults.scripts : { ...defaults.scripts, ...((existing.scripts ?? {}) as object) } };
  const config = parseConfig(data, root);
  const problems = await projectProblems(config, root);
  if (!options.force) problems.push(...await templateProblems(config, root));
  buildCompose(config, root, "development");
  buildCompose(config, root, "production");
  if (problems.length) throw new ConfigError(problems);
  // All validation happens before publishing any files.
  await mkdir(resolve(root, "ship"), { recursive: true });
  for (const [filename, contents] of Object.entries(await renderTemplates(config))) {
    const destination = resolve(root, "ship", filename);
    if (options.force || !(await exists(destination))) {
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, contents, { mode: filename.endsWith(".sh") ? 0o755 : 0o644 });
    }
  }
  await writeFile(path, JSON.stringify(config, null, 2) + "\n");
  await appendRules(resolve(root, ".dockerignore"), ["node_modules", "dist/ship", ".git", ".env", ".env.*", "!.env.example", "*.tgz", ".npmrc", "ship/.gatsby-static.json"]);
  await appendRules(resolve(root, ".gitignore"), ["node_modules/", ".env", ".env.*", "!.env.example", "dist/ship/", "ship/.gatsby-static.json", "ship/docker-compose.generated.yml", "ship/docker-compose.production.yml"]);
  return config;
}
