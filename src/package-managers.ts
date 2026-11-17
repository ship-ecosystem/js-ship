import { resolve } from "node:path";
import type { PackageManagerName, ProjectManifest, ShipConfig } from "./contracts.js";
import { exists } from "./config.js";
import { ConfigError } from "./errors.js";

import { DEFAULT_NPM_VERSION, EXACT_VERSION } from "./versions.js";
export { DEFAULT_NPM_VERSION, EXACT_VERSION } from "./versions.js";
const MANIFEST_MANAGER = /^(npm|pnpm)@(\d+\.\d+\.\d+)(?:\+sha(?:224|256|384|512)\.[a-fA-F0-9]+)?$/;
export interface PackageManager {
  name: PackageManagerName;
  lockfile: string;
  install: readonly string[];
  prune: readonly string[];
}
export const packageManagers: Record<PackageManagerName, PackageManager> = {
  npm: { name: "npm", lockfile: "package-lock.json", install: ["npm", "ci", "--include=dev", "--no-audit", "--no-fund"], prune: ["npm", "prune", "--omit=dev", "--no-audit", "--no-fund"] },
  pnpm: { name: "pnpm", lockfile: "pnpm-lock.yaml", install: ["pnpm", "install", "--frozen-lockfile", "--prod=false"], prune: ["pnpm", "prune", "--prod"] },
};

export function manifestManager(manifest: ProjectManifest): { name: PackageManagerName; version: string } | null {
  if (manifest.packageManager === undefined) return null;
  if (typeof manifest.packageManager !== "string") throw new ConfigError(["package.json packageManager must be an exact npm@VERSION or pnpm@VERSION string."]);
  const match = MANIFEST_MANAGER.exec(manifest.packageManager);
  if (!match || !EXACT_VERSION.test(match[2]!)) throw new ConfigError(["package.json packageManager must pin npm or pnpm to an exact stable version, such as pnpm@12.21.0. Yarn and Bun are not implemented yet."]);
  return { name: match[1] as PackageManagerName, version: match[2]! };
}

export async function detectPackageManager(root: string, manifest: ProjectManifest): Promise<{ name: PackageManagerName; version: string }> {
  const declared = manifestManager(manifest);
  const npm = await exists(resolve(root, "package-lock.json"));
  const pnpm = await exists(resolve(root, "pnpm-lock.yaml"));
  if (npm && pnpm) throw new ConfigError(["Conflicting npm and pnpm lockfiles. Select one package manager."]);
  if (declared) return declared;
  if (pnpm) throw new ConfigError(["Pin the pnpm version in package.json packageManager or pass --package-manager pnpm --package-manager-version VERSION."]);
  return { name: "npm", version: DEFAULT_NPM_VERSION };
}

export async function packageManagerProblems(config: ShipConfig, manifest: ProjectManifest, root: string): Promise<string[]> {
  const problems: string[] = [];
  const declared = manifestManager(manifest);
  if (declared && (declared.name !== config.packageManager || declared.version !== config.packageManagerVersion)) problems.push("ship.json package manager/version conflicts with package.json packageManager. Use matching exact versions.");
  const selected = packageManagers[config.packageManager];
  if (!(await exists(resolve(root, selected.lockfile)))) problems.push(`${selected.lockfile} is required; create and commit a lockfile first.`);
  for (const file of ["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"]) {
    if (file !== selected.lockfile && await exists(resolve(root, file))) problems.push(`${file} conflicts with the selected ${config.packageManager} workflow. Select one package manager.`);
  }
  if (manifest.workspaces || await exists(resolve(root, "pnpm-workspace.yaml"))) problems.push("Workspace projects are planned but not supported yet.");
  return problems;
}

export function scriptCommand(config: ShipConfig, script: string | null, extra: readonly string[] = []): readonly string[] {
  if (!script) throw new ConfigError(["The selected adapter requires a package.json script that is not configured."]);
  return [config.packageManager, "run", script, ...(config.packageManager === "npm" && extra.length ? ["--"] : []), ...extra];
}
