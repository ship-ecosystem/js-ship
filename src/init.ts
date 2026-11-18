import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { exists, parseConfig, readJson, readManifest } from "./config.js";
import { ConfigError } from "./errors.js";
import { adapterFor, detectFramework } from "./adapters.js";
import { buildProjectCompose } from "./compose.js";
import { loadExtensions } from "./extensions.js";
import type { ExtensionRegistry, ShipConfig } from "./contracts.js";
import { DEFAULT_NPM_VERSION, detectPackageManager, EXACT_VERSION, manifestManager, packageManagerProblems } from "./package-managers.js";
import { renderTemplates, templateProblems } from "./templates.js";
import { angularSettings } from "./angular.js";
import { applicationRoot, containedDirectory, resolveWorkspace } from "./workspaces.js";
import { BUILD_EXCLUSIONS } from "./build-environment.js";
import { defaultDeployment } from "./framework-profiles.js";

export interface InitOptions { force?: boolean; database?: string; cache?: string; framework?: string; packageManager?: string; packageManagerVersion?: string; deployment?: string; angularProject?: string; mongodbMode?: string; workspace?: string }
export async function projectProblems(config: ShipConfig, root: string, registry?: ExtensionRegistry): Promise<string[]> {
  registry ??= await loadExtensions(root, config.extensions);
  await resolveWorkspace(config, root);
  const appRoot = applicationRoot(config, root);
  const manifest = await readManifest(appRoot);
  const rootManifest = config.workspace ? await readManifest(root) : manifest;
  const problems = adapterFor(config, registry).validate(config, manifest);
  if (adapterFor(config, registry).packaging(config).kind === "static" && config.serverEntry !== null) problems.push("serverEntry applies only to Node deployment.");
  problems.push(...await packageManagerProblems(config, rootManifest, root));
  if (config.framework === "angular") {
    const expected = await angularSettings(appRoot, config.angularProject, config.deployment);
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

export async function planInitProject(root: string, options: InitOptions = {}, registry?: ExtensionRegistry): Promise<{ config: ShipConfig; registry: ExtensionRegistry; existing: Record<string, unknown> }> {
  const rootManifest = await readManifest(root);
  const path = resolve(root, "ship.json");
  const raw = await exists(path) ? await readJson(path) : {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ConfigError(["ship.json must contain an object."]);
  const existing = raw as Record<string, unknown>;
  const extensions = parseConfig({ extensions: existing.extensions }, root).extensions;
  registry ??= await loadExtensions(root, extensions);
  const workspace = parseConfig({ workspace: options.workspace === undefined ? existing.workspace ?? null : { ...((existing.workspace ?? {}) as object), app: options.workspace } }, root).workspace;
  const appRoot = applicationRoot({ workspace }, root);
  if (workspace) await containedDirectory(root, appRoot);
  const manifest = workspace ? await readManifest(appRoot) : rootManifest;
  const changedWorkspace = options.workspace !== undefined && options.workspace !== (existing.workspace as { app?: unknown } | null)?.app;
  const framework = options.framework ?? (changedWorkspace ? undefined : existing.framework) ?? detectFramework(manifest);
  if (typeof framework !== "string") throw new ConfigError(["framework must be a string."]);
  const changedFramework = changedWorkspace || (options.framework !== undefined && existing.framework !== undefined && options.framework !== existing.framework);
  const adapter = adapterFor({ framework }, registry);
  const inferredDeployment = adapter.defaultDeployment ?? defaultDeployment(framework);
  const deployment = options.deployment ?? (changedFramework ? inferredDeployment : existing.deployment) ?? inferredDeployment;
  if (deployment !== "node" && deployment !== "static") throw new ConfigError(["deployment must be node or static."]);
  const defaults = { ...adapter.defaults(manifest, deployment),
    ...(framework === "angular" ? await angularSettings(appRoot, options.angularProject ?? existing.angularProject, deployment) : {}) };
  const declared = manifestManager(rootManifest);
  const managerName = options.packageManager ?? existing.packageManager ?? declared?.name;
  const managerVersion = options.packageManagerVersion ?? existing.packageManagerVersion ??
    (declared && declared.name === managerName ? declared.version : managerName === "npm" ? DEFAULT_NPM_VERSION : undefined);
  const detected = managerName === undefined ? await detectPackageManager(root, rootManifest) : null;
  if (managerName !== undefined && managerName !== "npm" && managerName !== "pnpm" && managerName !== "yarn") throw new ConfigError(["--package-manager must be npm, pnpm or yarn."]);
  if ((managerName === "pnpm" || managerName === "yarn") && (typeof managerVersion !== "string" || !EXACT_VERSION.test(managerVersion))) throw new ConfigError([`Pin ${managerName} with package.json packageManager or --package-manager-version VERSION.`]);
  const services = { ...((existing.services ?? {}) as Record<string, string>) };
  for (const key of ["database", "cache"] as const) {
    const value = options[key];
    if (value === "none") delete services[key];
    else if (value !== undefined) services[key] = value;
  }
  const switching = changedFramework ||
    (options.deployment !== undefined && options.deployment !== (existing.deployment ?? inferredDeployment)) ||
    (options.angularProject !== undefined && existing.angularProject !== undefined && options.angularProject !== existing.angularProject);
  const data = { ...defaults, ...existing, extensions, workspace, framework, services,
    ...(switching || (options.force && framework === "angular") ? defaults : {}), deployment,
    ...(switching && framework !== "angular" ? { serverEntry: null } : {}),
    ...(options.mongodbMode ? { mongodbMode: options.mongodbMode } : {}),
    packageManager: managerName ?? detected!.name, packageManagerVersion: managerVersion ?? detected?.version,
    scripts: switching ? defaults.scripts : { ...defaults.scripts, ...((existing.scripts ?? {}) as object) } };
  const config = parseConfig(data, root);
  const problems = await projectProblems(config, root, registry);
  if (!options.force) problems.push(...await templateProblems(config, root, registry));
  await buildProjectCompose(config, root, "development", "local", registry);
  await buildProjectCompose(config, root, "production", "local", registry);
  if (problems.length) throw new ConfigError(problems);
  return { config, registry, existing };
}

export async function initProject(root: string, options: InitOptions = {}, registry?: ExtensionRegistry): Promise<ShipConfig> {
  const { config, registry: selectedRegistry, existing } = await planInitProject(root, options, registry);
  // All validation happens before publishing any files.
  await mkdir(resolve(root, "ship"), { recursive: true });
  for (const [filename, contents] of Object.entries(await renderTemplates(config, await resolveWorkspace(config, root), selectedRegistry))) {
    const destination = resolve(root, "ship", filename);
    if (filename === "ship.schema.json" || options.force || !(await exists(destination))) {
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, contents, { mode: filename.endsWith(".sh") ? 0o755 : 0o644 });
    }
  }
  await writeFile(resolve(root, "ship.json"), JSON.stringify({ $schema: existing.$schema ?? "./ship/ship.schema.json", ...config }, null, 2) + "\n");
  await appendRules(resolve(root, ".dockerignore"), [".ship-secrets", "**/.npmrc", "**/.env", "**/.env.*", "**/node_modules", "**/.yarn/cache", "**/.yarn/unplugged", "**/.yarn/install-state.gz", "**/.yarn/build-state.yml", "**/.pnp.*", "node_modules", "dist/ship", ".git", ".env", ".env.*", "!.env.example", "*.tgz", ".npmrc", "ship/.gatsby-static.json"]);
  const ignorePath = resolve(root, ".dockerignore");
  const ignore = await readFile(ignorePath, "utf8");
  const active = ignore.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith("#"));
  const lastNegation = active.reduce((last, line, index) => line.startsWith("!") ? index : last, -1);
  if (BUILD_EXCLUSIONS.some(rule => active.lastIndexOf(rule) <= lastNegation)) {
    await writeFile(ignorePath, `${ignore}\n# Keep credential exclusions after negation rules.\n${BUILD_EXCLUSIONS.join("\n")}\n`);
  }
  await appendRules(resolve(root, ".gitignore"), [".ship-secrets/", ".npmrc", "node_modules/", ".env", ".env.*", "!.env.example", "dist/ship/", "ship/.gatsby-static.json", "ship/docker-compose.generated.yml", "ship/docker-compose.production.yml"]);
  return config;
}
