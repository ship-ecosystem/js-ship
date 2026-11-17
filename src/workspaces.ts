import { glob, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ShipConfig, ProjectManifest, PackageManagerName } from "./contracts.js";
import { exists, readManifest, safeRelativePath } from "./config.js";
import { manifestManager } from "./package-managers.js";
import { ConfigError } from "./errors.js";

export const applicationRoot = (config: Pick<ShipConfig, "workspace">, root: string): string => resolve(root, config.workspace?.app ?? ".");
export async function containedDirectory(root: string, directory: string): Promise<void> {
  const inside = relative(await realpath(root), await realpath(directory));
  if (inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) throw new ConfigError(["Workspace directories must stay inside the project root, including symlink targets."]);
}
function patterns(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.some(pattern => typeof pattern !== "string" || !/^!?[A-Za-z0-9_.*\/-]+$/.test(pattern) ||
    pattern.replace(/^!/, "").split("/").some(part => !part || part === "." || part === ".." || (part.includes("**") && part !== "**")))) {
    throw new ConfigError(["Workspace packages must be a nonempty list of relative paths/globs using * or **, with optional ! exclusions. Braces, extglobs and parent paths are not supported yet."]);
  }
  return value as string[];
}
/** Read only pnpm's packages list. Other settings remain opaque and are interpreted by pnpm. */
async function pnpmPatterns(root: string): Promise<string[]> {
  const text = (await readFile(resolve(root, "pnpm-workspace.yaml"), "utf8")).replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/);
  const headers = lines.flatMap((line, index) => /^packages\s*:/.test(line) ? [index] : []);
  if (headers.length !== 1) throw new ConfigError(["pnpm-workspace.yaml needs exactly one top-level packages list."]);
  const start = headers[0]!;
  const header = lines[start]!.replace(/\s+#.*$/, "");
  const inline = header.slice(header.indexOf(":") + 1).trim();
  if (inline) {
    try { return patterns(JSON.parse(inline) as unknown); }
    catch { throw new ConfigError(["Use a block packages list or a JSON-style array in pnpm-workspace.yaml."]); }
  }
  const values: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    if (/^\S/.test(line)) break;
    const match = /^ +-[ \t]+(?:'([^']*)'|"([^"\\]*)"|([^'"#\s]+))\s*(?:#.*)?$/.exec(line);
    if (!match) throw new ConfigError(["Use plain or quoted scalar patterns in the pnpm packages block; YAML aliases and complex list syntax are not supported."]);
    values.push(match[1] ?? match[2] ?? match[3]!);
  }
  return patterns(values);
}
function matches(pattern: string, path: string): boolean {
  const parts = pattern.split("/");
  const source = parts.map((part, i) => part === "**" ? (i === parts.length - 1 ? ".*" : "(?:[^/]+/)*")
    : part.split("*").map(value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*") + (i < parts.length - 1 ? "/" : "")).join("");
  return new RegExp(`^${source}$`).test(path);
}
export async function workspacePackages(root: string, manager: PackageManagerName, manifest?: ProjectManifest): Promise<string[]> {
  const rootManifest = manifest ?? await readManifest(root);
  const declared = manager === "pnpm" ? await pnpmPatterns(root) : patterns(
    rootManifest.workspaces && typeof rootManifest.workspaces === "object" && !Array.isArray(rootManifest.workspaces)
      ? (rootManifest.workspaces as { packages?: unknown }).packages : rootManifest.workspaces);
  const includes = declared.filter(pattern => !pattern.startsWith("!"));
  const excludes = declared.filter(pattern => pattern.startsWith("!")).map(pattern => pattern.slice(1));
  const found = new Set<string>();
  for (const pattern of includes) {
    for await (const file of glob(`${pattern}/package.json`, { cwd: root, exclude: path => path.split(/[\\/]/).some(part => ["node_modules", ".git", ".ship-secrets"].includes(part)) })) {
      const path = file.replaceAll("\\", "/").slice(0, -"/package.json".length);
      if (!safeRelativePath(path) || excludes.some(pattern => matches(pattern, path))) continue;
      await containedDirectory(root, resolve(root, path));
      found.add(path);
    }
  }
  return [...found].sort();
}
export async function resolveWorkspace(config: ShipConfig, root: string): Promise<string[]> {
  if (!config.workspace) return [];
  if (config.packageManager === "npm" && await exists(resolve(root, "pnpm-workspace.yaml"))) throw new ConfigError(["An npm workspace cannot also contain pnpm-workspace.yaml."]);
  const packages = await workspacePackages(root, config.packageManager);
  for (const path of [config.workspace.app, ...config.workspace.buildDependencies]) {
    if (!packages.includes(path)) throw new ConfigError([`Workspace ${path} is not included by the root workspace package patterns.`]);
    await containedDirectory(root, resolve(root, path));
  }
  for (const path of config.workspace.buildDependencies) {
    const manifest = await readManifest(resolve(root, path));
    if (!manifest.scripts?.build) throw new ConfigError([`Workspace build dependency ${path} needs a build script.`]);
  }
  // No nested authority: one package manager and one root lockfile drive the repository.
  for (const path of packages) {
    const manifest = await readManifest(resolve(root, path));
    const declared = manifestManager(manifest);
    if (declared && (declared.name !== config.packageManager || declared.version !== config.packageManagerVersion)) throw new ConfigError([`Workspace ${path} declares a different packageManager; use the root pin consistently.`]);
    for (const lock of ["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb", "pnpm-workspace.yaml"]) {
      if (await exists(resolve(root, path, lock))) throw new ConfigError([`Workspace ${path}/${lock} conflicts with the root lockfile/workspace. Remove nested package-manager authority.`]);
    }
  }
  return packages;
}
