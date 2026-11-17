import { createReadStream } from "node:fs";
import { chmod, copyFile, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import type { ExtensionRegistry, ComposeModel, ShipConfig } from "./contracts.js";
import type { Runner } from "./process.js";
import { exists } from "./config.js";
import { commandArgv, render } from "./compose.js";
import { IMAGES, NODE_MINIMUMS } from "./images.js";
import { loadExtensions } from "./extensions.js";
import { ConfigError } from "./errors.js";
import { productionProblems } from "./production.js";
import { buildContextProblems, buildSecretProblems } from "./build-environment.js";
import { composePrefix } from "./project.js";

export const VERSION = "0.1.0-dev.0";
export function validateTag(tag: string): void {
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}(?![\s\S])/.test(tag)) throw new ConfigError(["Release tag must be a Docker tag (1–128 letters, digits, underscores, dots or hyphens; no leading dot or hyphen)."]);
}
export function releaseModel(model: ComposeModel): ComposeModel {
  const copy = structuredClone(model);
  for (const service of Object.values(copy.services)) {
    delete service.build;
    if (Array.isArray(service.env_file)) service.env_file = service.env_file.map(() => ({ path: ".env", required: true }));
  }
  delete copy.secrets;
  return copy;
}
const quote = (arg: string): string => `'${arg.replaceAll("'", "'\\''")}'`;
export function deployScript(config: ShipConfig, model: ComposeModel): string {
  const app = config.serviceNames.app ?? "app";
  const infrastructure = Object.keys(model.services).filter(name => name !== app && !Object.hasOwn(config.processes, name));
  return ["#!/bin/sh", "set -eu", 'cd "$(dirname "$0")"',
    ...(infrastructure.length ? [`docker compose up -d --wait ${infrastructure.map(quote).join(" ")}`] : []),
    ...config.deployCommands.map(command => `docker compose run --rm --no-deps ${quote(app)} ${commandArgv(command).map(quote).join(" ")}`), ""].join("\n");
}

export async function buildProduction(root: string, config: ShipConfig, runner: Runner, tag = "local", options: { noCache?: boolean; registry?: ExtensionRegistry } = {}): Promise<ComposeModel> {
  validateTag(tag);
  const { prefix, model } = await composePrefix(root, config, "production", tag, { ...(options.registry ? { registry: options.registry } : {}) });
  const problems = [...await productionProblems(model, root), ...await buildContextProblems(root), ...await buildSecretProblems(config, root)];
  if (problems.length) throw new ConfigError(problems);
  // Workers share the app image, and named MongoDB instances share one infrastructure image.
  const owners = new Map<string, string>();
  for (const [name, service] of Object.entries(model.services)) if (service.build && typeof service.image === "string" && !owners.has(service.image)) owners.set(service.image, name);
  await runner([...prefix, "build", "--pull", ...(options.noCache ? ["--no-cache"] : []), ...owners.values()], root);
  return model;
}

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export async function assembleRelease(root: string, config: ShipConfig, tag: string, runner: Runner, registry?: ExtensionRegistry): Promise<string> {
  validateTag(tag);
  registry ??= await loadExtensions(root, config.extensions);
  const parent = resolve(root, "dist", "ship");
  const destination = join(parent, tag);
  if (await exists(destination)) throw new ConfigError([`Release ${tag} already exists. Use a new tag; existing releases are preserved.`]);
  const { prefix, model } = await composePrefix(root, config, "production", tag, { ...(registry ? { registry } : {}) });
  const problems = await productionProblems(model, root, true);
  if (problems.length) throw new ConfigError(problems);
  await buildProduction(root, config, runner, tag, { ...(registry ? { registry } : {}) });
  // Pull infrastructure so every declared image is available for offline export.
  const infrastructure = Object.keys(model.services).filter(name => name !== (config.serviceNames.app ?? "app") && !Object.hasOwn(config.processes, name));
  const pullable = infrastructure.filter(name => !model.services[name]!.build);
  if (pullable.length) await runner([...prefix, "pull", ...pullable], root);
  await mkdir(parent, { recursive: true });
  const stage = await mkdtemp(join(parent, ".release-"));
  try {
    await chmod(stage, 0o700);
    await mkdir(join(stage, "images"));
    const compose = releaseModel(model);
    await writeFile(join(stage, "docker-compose.yml"), render(compose));
    await copyFile(resolve(root, ".env.production"), join(stage, ".env"));
    await chmod(join(stage, ".env"), 0o600);
    const byImage = new Map<string, string[]>();
    for (const [service, definition] of Object.entries(compose.services)) {
      if (typeof definition.image !== "string") throw new ConfigError([`Service ${service} has no exportable image.`]);
      byImage.set(definition.image, [...(byImage.get(definition.image) ?? []), service]);
    }
    const images = [];
    for (const [image, services] of byImage) {
      const file = `images/${services[0]!}.tar`;
      const path = join(stage, file);
      await runner(["docker", "save", "-o", path, image], root);
      images.push({ image, file, sha256: await sha256(path), services });
    }
    if (config.deployCommands.length) await writeFile(join(stage, "deploy-commands.sh"), deployScript(config, compose), { mode: 0o700 });
    await writeFile(join(stage, "release.json"), JSON.stringify({ tag, ship: { package: "js-ship", version: VERSION }, extensions: { definitions: registry.extensions, fingerprint: registry.fingerprint }, runtimePolicy: { minimums: NODE_MINIMUMS, baseImages: IMAGES }, images }, null, 2) + "\n");
    await writeFile(join(stage, "README.md"), [`# Release ${tag}`, "", "Requires Docker Engine and Compose 2.24.0+. From this directory:", "", "```sh",
      ...images.map(entry => `docker load -i ${entry.file}`), ...(config.deployCommands.length ? ["sh deploy-commands.sh"] : []), "docker compose up -d", "```", "",
      "This directory contains production secrets in .env. Keep it private.", "Production ports are disabled by default; connect your reverse proxy to the Docker network.", ""].join("\n"));
    await rename(stage, destination);
    return destination;
  } finally { await rm(stage, { recursive: true, force: true }); }
}
