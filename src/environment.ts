import { chmod, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ComposeModel } from "./contracts.js";
import { exists } from "./config.js";
import { parseEnv } from "./production.js";

/** Names and development defaults, never inferred from the host's environment. */
export function environmentDefaults(model: ComposeModel): Record<string, string> {
  const values: Record<string, string> = {};
  function visit(value: unknown): void {
    if (typeof value === "string") for (const match of value.matchAll(/\$\$|\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:-|-|:\?|\?)([^}]*))?\}/g)) {
      if (match[1] && !Object.hasOwn(values, match[1])) values[match[1]] = match[2] === ":-" || match[2] === "-" ? match[3] ?? "" : "";
    }
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  }
  visit(model);
  return values;
}
/** Append missing names only. Project-owned values and comments are preserved. */
async function appendEnvironment(path: string, values: Record<string, string>, privateFile = false): Promise<void> {
  const current = await exists(path) ? await readFile(path, "utf8") : "";
  const declared = parseEnv(current);
  const entries = Object.entries(values).filter(([key]) => !Object.hasOwn(declared, key));
  if (!entries.length) return;
  const added = entries.sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n");
  await writeFile(path, `${current}${current && !current.endsWith("\n") ? "\n" : ""}\n# JavaScript Ship — review values before use\n${added}\n`, { mode: privateFile ? 0o600 : 0o644 });
  if (privateFile) await chmod(path, 0o600);
}
export async function writeEnvironmentExamples(root: string, development: ComposeModel, production: ComposeModel): Promise<void> {
  const defaults = environmentDefaults(development);
  const required = new Set([...JSON.stringify(production).matchAll(/\$\$|\$\{([A-Za-z_][A-Za-z0-9_]*):\?/g)].flatMap(m => m[1] ? [m[1]] : []));
  await appendEnvironment(resolve(root, ".env"), defaults, true);
  await appendEnvironment(resolve(root, ".env.example"), defaults);
  await appendEnvironment(resolve(root, ".env.production.example"), Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, required.has(key) ? "CHANGE_ME" : value])));
}
