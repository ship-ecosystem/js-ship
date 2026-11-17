import { access, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { exists } from "./config.js";
import type { ShipConfig } from "./contracts.js";

// Keep these last, after user negation rules, so COPY cannot reintroduce credentials.
export const BUILD_EXCLUSIONS = [".ship-secrets", "**/.ship-secrets", "**/.npmrc", "**/.env", "**/.env.*"] as const;
export async function buildContextProblems(root: string): Promise<string[]> {
  const problems: string[] = [];
  if (await exists(resolve(root, "ship/Dockerfile.dockerignore"))) problems.push("ship/Dockerfile.dockerignore overrides the protected build context; merge it into .dockerignore and remove it.");
  const path = resolve(root, ".dockerignore");
  const rules = await exists(path) ? (await readFile(path, "utf8")).split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith("#")) : [];
  const lastNegation = rules.reduce((last, line, index) => line.startsWith("!") ? index : last, -1);
  if (BUILD_EXCLUSIONS.some(rule => rules.lastIndexOf(rule) <= lastNegation)) problems.push("Protected build-context exclusions are missing or followed by negation rules. Run ship init to refresh .dockerignore.");
  return problems;
}
export async function buildSecretProblems(config: ShipConfig, root: string, development = false): Promise<string[]> {
  const names = [...(config.build.npmrc ? ["npmrc"] : []), ...(development ? [] : config.build.secrets)];
  const problems: string[] = [];
  for (const name of names) {
    try {
      await access(resolve(root, ".ship-secrets", name), 4);
      if (!(await stat(resolve(root, ".ship-secrets", name))).isFile()) throw new Error("Not a regular file");
    } catch { problems.push(`Required secret file .ship-secrets/${name} is missing or unreadable.`); }
  }
  return problems;
}
