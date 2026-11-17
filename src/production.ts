import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ComposeModel } from "./contracts.js";
import { exists } from "./config.js";
import { ConfigError } from "./errors.js";

export function parseEnv(text: string): Record<string, string> {
  const values: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const line of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1]!, raw = match[2]!;
    let value: string;
    if (raw.startsWith("'")) {
      const end = raw.indexOf("'", 1);
      if (end < 0) throw new ConfigError([`Unclosed quote for ${key} in production environment.`]);
      value = raw.slice(1, end);
    } else if (raw.startsWith('"')) {
      const quoted = /^"((?:\\.|[^"\\])*)"/.exec(raw);
      if (!quoted) throw new ConfigError([`Unclosed quote for ${key} in production environment.`]);
      value = quoted[1]!.replace(/\\(["\\$])/g, "$1").replaceAll("\\n", "\n");
    } else value = raw.replace(/\s+#.*$/, "").trim();
    values[key] = value;
  }
  return values;
}

export async function productionProblems(model: ComposeModel, root: string, requireFile = false): Promise<string[]> {
  const required = [...new Set([...JSON.stringify(model).matchAll(/\$\$|\$\{([A-Za-z_][A-Za-z0-9_]*):\?/g)].flatMap(m => m[1] ? [m[1]] : []))];
  const path = resolve(root, ".env.production");
  if (!(await exists(path))) return required.length || requireFile ? [".env.production is required for this production stack."] : [];
  const values = parseEnv(await readFile(path, "utf8"));
  return required.flatMap(key => !values[key] ? [`${key} is required in .env.production.`]
    : ["shipsecret", "shiprootsecret", "changeme"].includes(values[key]!.toLowerCase()) ? [`${key} still uses a development credential.`] : []);
}
