import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { exists, parseConfig, readConfig, readManifest } from "./config.js";
import { ConfigError } from "./errors.js";
import { composePrefix } from "./project.js";
import { renderTemplates } from "./templates.js";
import { resolveWorkspace } from "./workspaces.js";
import { loadExtensions } from "./extensions.js";
import { DEFAULT_NPM_VERSION, EXACT_VERSION, packageManagers } from "./package-managers.js";
import { initProject } from "./init.js";
import type { PackageManagerName } from "./contracts.js";
import type { Runner } from "./process.js";

export interface SwitchOptions { yes?: boolean; force?: boolean; confirm?: (message: string) => Promise<boolean> }
/** Switch in the running development container; never execute a package tool on the host. */
export async function switchPackageManager(root: string, target: string, runner: Runner, options: SwitchOptions = {}): Promise<void> {
  const match = /^(npm|pnpm|yarn)(?:@(.+))?$/.exec(target);
  if (!match) throw new ConfigError(["Usage: ship package-manager npm|pnpm|yarn[@EXACT_VERSION] [--yes] [--force]"]);
  const config = await readConfig(root), manifest = await readManifest(root);
  const name = match[1] as PackageManagerName;
  const version = match[2] ?? (name === config.packageManager ? config.packageManagerVersion : name === "npm" ? DEFAULT_NPM_VERSION : "");
  if (!EXACT_VERSION.test(version)) throw new ConfigError(["Supply an exact stable package-manager version; latest and ranges are not reproducible."]);
  const next = parseConfig({ ...config, packageManager: name, packageManagerVersion: version }, root);
  const registry = await loadExtensions(root, config.extensions);
  const oldTemplates = await renderTemplates(config, await resolveWorkspace(config, root), registry);
  if (!options.force) for (const [file, expected] of Object.entries(oldTemplates)) {
    const path = resolve(root, "ship", file);
    if (file !== "ship.schema.json" && await exists(path) && await readFile(path, "utf8") !== expected) throw new ConfigError([`ship/${file} has custom edits. Back them up and use --force to regenerate templates during the package-manager switch.`]);
  }
  const foreign = ["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock"].filter(file => file !== packageManagers[name].lockfile);
  const removed: string[] = [];
  for (const file of foreign) if (await exists(resolve(root, file))) removed.push(file);
  const message = `Switch to ${name}@${version}; replace ${removed.join(", ") || "no foreign lockfiles"}, reinstall container dependencies and regenerate Ship templates${options.force ? " (including custom edits)" : ""}?`;
  if (!options.yes && !await options.confirm?.(message)) throw new ConfigError(["Package-manager switch cancelled; no files changed. Use --yes for automation after reviewing the lockfile changes."]);
  const { prefix } = await composePrefix(root, config, "development", "local", { registry });
  const app = config.serviceNames.app ?? "app";
  // Fail before touching manifests if the app is not running.
  await runner([...prefix, "exec", "-T", app, "node", "--version"], root, { capture: true });
  const files = ["package.json", "ship.json", "package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock", ".yarnrc.yml", ".env", ".env.example", ".env.production.example", ".gitignore", ".dockerignore", ...Object.keys(oldTemplates).map(file => `ship/${file}`)];
  const backup = new Map<string, Buffer | null>();
  for (const file of files) backup.set(file, await exists(resolve(root, file)) ? await readFile(resolve(root, file)) : null);
  try {
    const distribution = name === "yarn" ? "@yarnpkg/cli-dist" : name;
    await runner([...prefix, "exec", "-T", "--user", "0", "--workdir", "/app", app, "npm", "install", "--global", "--force", "--engine-strict", `${distribution}@${version}`, ...(name === "pnpm" ? ["--allow-scripts=pnpm"] : []), "--no-audit", "--no-fund"], root);
    await writeFile(resolve(root, "package.json"), JSON.stringify({ ...manifest, packageManager: `${name}@${version}` }, null, 2) + "\n");
    if (name === "yarn") {
      const path = resolve(root, ".yarnrc.yml");
      const text = await exists(path) ? await readFile(path, "utf8") : "";
      if (/^nodeLinker:/m.test(text) && !/^nodeLinker:\s*['"]?node-modules['"]?\s*(?:#.*)?$/m.test(text)) throw new ConfigError(["Existing .yarnrc.yml chooses another linker; set nodeLinker: node-modules before switching."]);
      if (!/^nodeLinker:/m.test(text)) await writeFile(path, `${text}${text && !text.endsWith("\n") ? "\n" : ""}nodeLinker: node-modules\n`);
    }
    for (const file of removed) await rm(resolve(root, file));
    const install = name === "npm" ? ["npm", "install", "--no-audit", "--no-fund"] : name === "pnpm" ? ["pnpm", "install", "--no-frozen-lockfile", "--force"] : ["env", "YARN_NODE_LINKER=node-modules", "YARN_ENABLE_IMMUTABLE_INSTALLS=false", "yarn", "install"];
    await runner([...prefix, "exec", "-T", "--workdir", "/app", app, ...(next.build.npmrc ? ["env", "NPM_CONFIG_USERCONFIG=/run/secrets/ship_npmrc"] : []), ...install], root);
    if (!await exists(resolve(root, packageManagers[name].lockfile))) throw new ConfigError([`${name} did not create ${packageManagers[name].lockfile}; manifests will be restored.`]);
    await initProject(root, { packageManager: name, packageManagerVersion: version, force: true }, registry);
  } catch (error) {
    for (const [file, bytes] of backup) if (bytes === null) await rm(resolve(root, file), { force: true }); else await writeFile(resolve(root, file), bytes);
    throw error;
  }
}
