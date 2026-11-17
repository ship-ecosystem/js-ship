import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { buildCompose, render } from "./compose.js";
import { exists, readConfig } from "./config.js";
import { projectProblems } from "./init.js";
import { ConfigError } from "./errors.js";
import type { ComposeModel, Environment, ShipConfig } from "./contracts.js";
import { adapterFor } from "./adapters.js";
import { templateProblems } from "./templates.js";

export async function loadProject(root: string): Promise<ShipConfig> {
  const config = await readConfig(root);
  const problems = await projectProblems(config, root);
  problems.push(...await templateProblems(config, root));
  const mongo = Object.values(config.services).includes("mongodb") || config.additionalServices.some(s => s.service === "mongodb");
  for (const filename of ["Dockerfile", "dev-entrypoint.sh", "app-entrypoint.mjs", "prepare-output.mjs", "output.json",
    ...(config.framework === "gatsby" ? ["gatsby-adapter.cjs"] : []),
    ...(mongo ? ["mongodb/Dockerfile", "mongodb/entrypoint.sh", "mongodb/bootstrap.sh", "mongodb/bootstrap.js", "mongodb/health.js", "mongodb/app-user.js"] : []),
    ...(adapterFor(config).packaging(config).kind === "static" ? ["nginx.conf"] : [])]) {
    if (!(await exists(resolve(root, "ship", filename)))) problems.push(`ship/${filename} is missing; run ship init.`);
  }
  if (problems.length) throw new ConfigError(problems);
  return config;
}

export async function composePrefix(root: string, config: ShipConfig, environment: Environment, tag = "local", options: { refreshApp?: boolean } = {}): Promise<{ prefix: string[]; model: ComposeModel }> {
  const model = buildCompose(config, root, environment, tag);
  if (environment === "development" && options.refreshApp) {
    // Dependency proxies can mutate node_modules without changing the startup manifest.
    // Recreate only app on every explicit up so its frozen install is never bypassed.
    model.services[config.serviceNames.app ?? "app"]!.labels = { "io.ship.dev-start": randomUUID() };
  }
  const filename = resolve(root, "ship", environment === "development" ? "docker-compose.generated.yml" : "docker-compose.production.yml");
  await mkdir(resolve(root, "ship"), { recursive: true });
  await writeFile(filename, render(model));
  const prefix = ["docker", "compose", "--project-directory", root];
  const env = resolve(root, environment === "development" ? ".env" : ".env.production");
  if (await exists(env)) prefix.push("--env-file", env);
  prefix.push("-f", filename);
  if (environment === "development") {
    for (const override of ["docker-compose.override.yml", "compose.override.yaml"]) {
      const path = resolve(root, override);
      if (await exists(path)) { prefix.push("-f", path); break; }
    }
  }
  return { prefix, model };
}
