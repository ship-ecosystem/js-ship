import { createReadStream, readFileSync } from "node:fs";
import { chmod, readFile, copyFile, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import type { ExtensionRegistry, ComposeModel, ShipConfig } from "./contracts.js";
import type { Runner } from "./process.js";
import { exists } from "./config.js";
import { commandArgv, externalNetworks, processDefinition, selections, render } from "./compose.js";
import { adapterFor } from "./adapters.js";

import { loadExtensions } from "./extensions.js";
import { ConfigError } from "./errors.js";
import { parseEnv, productionProblems } from "./production.js";
import { buildContextProblems, buildSecretProblems } from "./build-environment.js";
import { composePrefix } from "./project.js";

// The installed manifest is authoritative for CLI and exported release metadata.
export const VERSION: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
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
export function deploymentPlan(config: ShipConfig, model: ComposeModel) {
  return config.deployCommands.length ? { service: config.serviceNames.app ?? "app", needs: Object.keys(model.services).filter(name => name !== (config.serviceNames.app ?? "app") && !Object.hasOwn(config.processes, name)).sort(), commands: config.deployCommands.map(commandArgv) } : null;
}
export function deployScript(config: ShipConfig, model: ComposeModel): string {
  const plan = deploymentPlan(config, model);
  const app = config.serviceNames.app ?? "app";
  const infrastructure = plan?.needs ?? [];
  return ["#!/bin/sh", "set -eu", 'cd "$(dirname "$0")"',
    ...(infrastructure.length ? [`docker compose up -d --wait ${infrastructure.map(quote).join(" ")}`] : []),
    ...(plan?.commands ?? []).map(command => `docker compose run --rm --no-deps -T ${quote(app)} ${command.map(quote).join(" ")}`), ""].join("\n");
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

export interface ReleaseOptions { noEnv?: boolean }
interface ImageDetails { Id: string; Os: string; Architecture: string; Variant?: string; RepoDigests?: string[] }
async function inspectImage(ref: string, root: string, runner: Runner): Promise<ImageDetails> {
  const text = await runner(["docker", "image", "inspect", ref], root, { capture: true });
  let image: ImageDetails | undefined;
  try { image = (JSON.parse(text) as ImageDetails[])[0]; } catch { /* actionable diagnostic below */ }
  if (!image || !/^sha256:[a-f0-9]{64}$/.test(image.Id) || !image.Os || !image.Architecture) throw new ConfigError([`Cannot inspect release image ${ref}: Docker must return an image ID and platform.`]);
  return image;
}
const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();
export function interpolationMetadata(model: ComposeModel) {
  const referenced: string[] = [], required: string[] = [];
  for (const match of JSON.stringify(model).matchAll(/\$\$|\$\{([A-Za-z_][A-Za-z0-9_]*)([^}]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g)) {
    const key = match[1] ?? match[3];
    if (key) { referenced.push(key); if (/^:?\?/.test(match[2] ?? "")) required.push(key); }
  }
  return { referenced: sorted(referenced), required: sorted(required) };
}
async function sourceMetadata(root: string, runner: Runner) {
  try {
    const commit = (await runner(["git", "rev-parse", "HEAD"], root, { capture: true })).trim();
    if (!/^[a-f0-9]{40,64}$/.test(commit)) return { gitCommit: null, dirty: null };
    const status = await runner(["git", "status", "--porcelain", "--", ".", ":(exclude)dist/ship", ":(exclude)ship/docker-compose.generated.yml", ":(exclude)ship/docker-compose.production.yml"], root, { capture: true });
    return { gitCommit: commit, dirty: !!status.trim() };
  } catch { return { gitCommit: null, dirty: null }; }
}
function namedVolumes(service: Record<string, unknown>, model: ComposeModel): string[] {
  return sorted((Array.isArray(service.volumes) ? service.volumes : []).flatMap(mount => {
    const source = typeof mount === "string" ? mount.split(":")[0] : mount && typeof mount === "object" && mount.type !== "bind" ? mount.source : null;
    return typeof source === "string" && Object.hasOwn(model.volumes, source) ? [source] : [];
  }));
}
export async function assembleRelease(root: string, config: ShipConfig, tag: string, runner: Runner, registry?: ExtensionRegistry, options: ReleaseOptions = {}): Promise<string> {
  validateTag(tag);
  registry ??= await loadExtensions(root, config.extensions);
  const parent = resolve(root, "dist", "ship");
  const destination = join(parent, tag);
  if (await exists(destination)) throw new ConfigError([`Release ${tag} already exists. Use a new tag; existing releases are preserved.`]);
  const { prefix, model } = await composePrefix(root, config, "production", tag, { registry });
  const problems = await productionProblems(model, root);
  if (problems.length) throw new ConfigError(problems);
  await buildProduction(root, config, runner, tag, { registry });
  const ownedRefs = new Set(Object.values(model.services).filter(service => service.build).map(service => service.image));
  const pullable = Object.keys(model.services).filter(name => !ownedRefs.has(model.services[name]!.image));
  if (pullable.length) await runner([...prefix, "pull", ...pullable], root);
  await mkdir(parent, { recursive: true });
  const stage = await mkdtemp(join(parent, ".release-"));
  try {
    await chmod(stage, 0o700);
    await mkdir(join(stage, "images"));
    const compose = releaseModel(model);
    const envPath = resolve(root, ".env.production");
    const hasEnv = await exists(envPath);
    const keys = hasEnv ? sorted(Object.keys(parseEnv(await readFile(envPath, "utf8")))) : [];
    const includeEnv = hasEnv && !options.noEnv;
    if (includeEnv) { await copyFile(envPath, join(stage, ".env")); await chmod(join(stage, ".env"), 0o600); }
    // Missing runtime env files remain optional; Compose interpolation still requires
    // declared credentials. --no-env recipients supply settings on the destination.
    for (const service of Object.values(compose.services)) if (Array.isArray(service.env_file)) service.env_file = [{ path: ".env", required: false }];
    const byImage = new Map<string, string[]>();
    for (const [service, definition] of Object.entries(compose.services)) {
      if (typeof definition.image !== "string") throw new ConfigError([`Service ${service} has no exportable image.`]);
      byImage.set(definition.image, [...(byImage.get(definition.image) ?? []), service]);
    }
    const images: { ref: string; id: string; file: string; sha256: string; services: string[] }[] = [];
    const pulledImages: { ref: string; services: string[] }[] = [];
    let platform: string | undefined;
    for (const [ref, users] of byImage) {
      const services = sorted(users);
      const info = await inspectImage(ref, root, runner);
      const owned = users.some(name => !!model.services[name]!.build);
      if (owned) {
        const imagePlatform = `${info.Os}/${info.Architecture}${info.Variant ? `/${info.Variant}` : ""}`;
        if (platform && platform !== imagePlatform) throw new ConfigError([`Project-built images have mixed platforms: ${platform} and ${imagePlatform}. Build them for one destination platform.`]);
        platform = imagePlatform;
        const file = `images/${services.includes(config.serviceNames.app ?? "app") ? config.serviceNames.app ?? "app" : services[0]!}.tar`;
        const path = join(stage, file);
        await runner(["docker", "save", "-o", path, ref], root);
        images.push({ ref, id: info.Id, file, sha256: await sha256(path), services });
      } else {
        const repository = ref.split("@")[0]!.replace(/:[^/:]+$/, "").replace(/^(?:docker.io\/)?(?:library\/)?/, "");
        const digest = info.RepoDigests?.find(value => value.split("@")[0]!.replace(/^(?:docker.io\/)?(?:library\/)?/, "") === repository)?.split("@")[1];
        if (!digest || !/^sha256:[a-f0-9]{64}$/.test(digest)) throw new ConfigError([`Registry image ${ref} has no matching repository digest. Pull it from its registry before releasing.`]);
        const pinned = `${ref.split("@")[0]}@${digest}`;
        for (const name of services) compose.services[name]!.image = pinned;
        pulledImages.push({ ref: pinned, services });
      }
    }
    if (!platform) throw new ConfigError(["Release has no project-built image."]);
    const app = config.serviceNames.app ?? "app";
    const plan = adapterFor(config, registry).packaging(config);
    const http = [{ service: app, port: plan.port, role: "site", health: null as string | null, urlSetting: null as string | null },
      ...Object.entries(config.processes).flatMap(([service, value]) => { const h = processDefinition(value).http; return h ? [{ service, port: h.port, role: h.role, health: h.health ?? null, urlSetting: h.urlSetting ?? null }] : []; }),
      ...selections(config, "production", root, registry).flatMap(({ definition, context }) => definition.http?.(context).map(h => ({ service: context.serviceName, port: h.port, role: h.role, health: h.health ?? null, urlSetting: h.urlSetting ?? null })) ?? [])];
    const interpolation = interpolationMetadata(compose);
    if (interpolation.required.some(key => !keys.includes(key))) throw new ConfigError(["Production settings must declare every required Compose variable."]);
    const deploy = deploymentPlan(config, compose);
    const metadata = {
      format: "ship-release", app: compose.name, tag, createdAt: new Date().toISOString(),
      builder: { package: "js-ship", version: VERSION }, source: await sourceMetadata(root, runner), platform,
      compose: "docker-compose.yml", images, pulledImages, http,
      services: Object.fromEntries(Object.entries(compose.services).map(([name, service]) => [name, {
        role: name === app ? "app" : Object.hasOwn(config.processes, name) ? "process" : "infrastructure", image: service.image,
        healthcheck: !!service.healthcheck && !(service.healthcheck as { disable?: boolean }).disable && (service.healthcheck as { test?: string[] }).test?.[0] !== "NONE", volumes: namedVolumes(service, compose),
      }])),
      framework: config.framework === "generic" ? null : config.framework, runtime: plan.kind === "static" ? "nginx" : "node",
      env: { file: includeEnv ? ".env" : null, keys, ...interpolation }, deploy, requires: { networks: sorted(externalNetworks(config)) },
      console: { service: app, user: plan.kind === "static" ? "101" : "node", shell: ["sh"], commands: plan.kind === "static" ? {} : { node: ["node"], [config.packageManager]: [config.packageManager] } },
      extensions: { definitions: registry.extensions, fingerprint: registry.fingerprint },
    };
    await writeFile(join(stage, "docker-compose.yml"), render(compose));
    if (deploy) await writeFile(join(stage, "deploy-commands.sh"), deployScript(config, compose), { mode: 0o755 });
    await writeFile(join(stage, "README.md"), [`# Release ${tag}`, "", `Ship application: ${compose.name}. Platform: ${platform}.`, "", "Requires Docker Engine and Compose 2.24.0+. From this directory:", "", "```sh",
      ...images.map(entry => `docker load -i ${entry.file}`), ...(pulledImages.length ? [`docker compose pull ${pulledImages.flatMap(entry => entry.services).map(quote).join(" ")}`] : []), ...(deploy ? ["./deploy-commands.sh"] : []), "docker compose up -d", "```", "",
      includeEnv ? "This directory contains production secrets in .env. Keep it private." : "No settings file is bundled. Provision .env on the destination (mode 0600) for application settings and Compose interpolation before deploying.",
      "Create the external networks listed in release.json before deploying. Production ports are disabled by default; connect a reverse proxy to the declared HTTP services.",
      "The settings file supplies runtime values. Public frontend values were compiled into the image at build time and cannot be changed by editing .env.", ""].join("\n"));
    // Completeness marker: no release files may be written after this manifest.
    await writeFile(join(stage, "release.json"), JSON.stringify(metadata, null, 2) + "\n");
    await rename(stage, destination);
    return destination;
  } finally { await rm(stage, { recursive: true, force: true }); }
}
