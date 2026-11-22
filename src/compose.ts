import { createHash } from "node:crypto";
import { resolveWorkspace } from "./workspaces.js";
import { resolve } from "node:path";
import type { ExtensionRegistry, Command, ComposeModel, Environment, ServiceContext, ServiceDefinition, ShipConfig, ProcessConfig, ProcessDefinition } from "./contracts.js";
import { adapterFor } from "./adapters.js";
import { IMAGES } from "./images.js";
import { loadExtensions } from "./extensions.js";
import { ConfigError } from "./errors.js";
import { builtinServices, serviceContext } from "./services.js";

export const processDefinition = (value: ProcessConfig): ProcessDefinition => typeof value === "string" || Array.isArray(value) ? { command: value as Command } : value as ProcessDefinition;
export const externalNetworks = (config: ShipConfig): string[] => config.externalNetwork === null ? [] : typeof config.externalNetwork === "string" ? [config.externalNetwork] : [...config.externalNetwork];
export function commandArgv(command: Command): string[] {
  return typeof command === "string" ? ["sh", "-c", command] : [...command];
}
/** Only literal commands need escaping. Service environment already contains Compose expressions. */
export function composeCommand(command: readonly string[]): string[] { return command.map(arg => arg.replaceAll("$", () => "$$")); }

export interface Selection { definition: ServiceDefinition; context: ServiceContext }
export function selections(config: ShipConfig, environment: Environment, root?: string, registry?: ExtensionRegistry): Selection[] {
  const entries = [
    ...Object.entries(config.services).map(([group, service]) => ({ group, service, name: null })),
    ...config.additionalServices,
  ];
  return entries.map(entry => {
    const services = registry?.services ?? builtinServices;
    const definition = services.get(entry.service);
    if (!definition || definition.group !== entry.group) throw new ConfigError([`Unknown ${entry.group} service ${entry.service}. Available: ${[...services.values()].map(service => `${service.key} (${service.group})`).join(", ")}.`]);
    const resource = entry.name ? `${entry.service}-${entry.name}` : entry.service;
    return { definition, context: serviceContext(environment, entry.service, entry.name, config.serviceNames[resource] ?? resource, { config, ...(root ? { projectRoot: root } : {}) }) };
  });
}

export function buildCompose(config: ShipConfig, root: string, environment: Environment, tag = "local", workspacePackages: readonly string[] = [], registry?: ExtensionRegistry): ComposeModel {
  if (config.extensions.length && !registry) throw new ConfigError(["Load the extension registry before synchronous planning, or use buildProjectCompose."]);
  if (config.workspace && !workspacePackages.includes(config.workspace.app)) throw new ConfigError(["Workspace Compose generation needs resolved package paths. Use buildProjectCompose for workspace projects."]);
  const production = environment === "production";
  const selected = selections(config, environment, root, registry);
  const adapter = adapterFor(config, registry);
  const plan = adapter.packaging(config);
  if (config.workspace && plan.kind === "node" && plan.runtime && plan.runtime !== "project" && !["next", "nuxt"].includes(config.framework)) throw new ConfigError(["Workspace Node output currently supports generic, Express, Fastify, NestJS, Next.js standalone and Nuxt Node. Other framework-isolated Node output needs a separate workspace packaging strategy."]);
  if (config.workspace && config.framework === "gatsby") throw new ConfigError(["Gatsby workspace adapter placement is not implemented yet. Use a standalone Gatsby Ship project."]);
  if (plan.kind === "static" && (Object.keys(config.processes).length || config.deployCommands.length || config.runtimeFiles.length)) throw new ConfigError(["Static images cannot run Node workers, deploy commands or runtimeFiles. Use a backend Ship project."]);
  const targetPort = production ? plan.port : config.port;
  const app = config.serviceNames.app ?? "app";
  const validRenames = new Set(["app", ...selected.map(s => s.context.resourceName)]);
  const problems: string[] = [];
  for (const key of Object.keys(config.serviceNames)) if (!validRenames.has(key)) problems.push(`serviceNames refers to absent service ${key}.`);
  const names = [app, ...selected.map(s => s.context.serviceName), ...Object.keys(config.processes)];
  if (new Set(names).size !== names.length) problems.push("App, service and process names collide after serviceNames renaming.");
  if (problems.length) throw new ConfigError(problems);
  const networks: Record<string, Record<string, unknown>> = { ship: {} };
  const external = externalNetworks(config);
  const externalKeys = external.map((_, i) => i === 0 ? "external" : `external_${i + 1}`);
  external.forEach((name, i) => { networks[externalKeys[i]!] = { external: true, name }; });
  const model: ComposeModel = { name: config.name + (production ? "-production" : ""), services: {}, volumes: {}, networks };
  const environmentVars: Record<string, string> = { NODE_ENV: production ? "production" : "development", HOST: "0.0.0.0", PORT: String(config.port) };
  if (config.framework === "next" && plan.kind === "node") environmentVars.HOSTNAME = "0.0.0.0";
  if (config.framework === "angular" && !production) environmentVars.NG_ALLOWED_HOSTS = "${NG_ALLOWED_HOSTS:-localhost,127.0.0.1}";
  const depends: Record<string, { condition: string }> = {};
  const ownedBuilds = new Map<string, string>();
  for (const { definition, context } of selected) {
    if (production && definition.developmentOnly) continue;
    const fragment = definition.compose(context);
    const ownedVolumes = new Set((definition.volumes ?? []).map(suffix => context.volume(suffix)));
    if (fragment.volumes !== undefined && !Array.isArray(fragment.volumes)) throw new ConfigError([`Service ${definition.key} volumes must be a Compose mount array.`]);
    for (const mount of (fragment.volumes ?? []) as unknown[]) {
      const source = typeof mount === "string" && mount.includes(":") ? mount.split(":")[0]
        : mount && typeof mount === "object" && "source" in mount && (!("type" in mount) || mount.type !== "bind") ? mount.source : null;
      if (typeof source === "string" && !source.includes("/") && !source.startsWith(".") && !ownedVolumes.has(source)) throw new ConfigError([`Service ${definition.key} references undeclared named volume ${source}. Declare its suffix in volumes and use context.volume().`]);
    }
    if (fragment.build) {
      const signature = JSON.stringify(fragment.build);
      if (definition.key !== "garage" && ownedBuilds.has(definition.key) && ownedBuilds.get(definition.key) !== signature) throw new ConfigError([`Named ${definition.key} instances must share an identical build definition; use separate service keys for different images.`]);
      ownedBuilds.set(definition.key, signature);
    }
    model.services[context.serviceName] = { ...fragment, ...(fragment.build ? { image: `${config.name}-${definition.key === "garage" ? context.resourceName : definition.key}:${tag}` } : {}), networks: ["ship", ...(definition.http ? externalKeys : [])], ...(definition.onDemand ? { profiles: ["ship-testing"] } : {}) };
    if (plan.kind === "node" || (!production && definition.developmentOnly)) Object.assign(environmentVars, definition.appEnvironment(context));
    const health = fragment.healthcheck;
    const disabled = health && typeof health === "object" && (("disable" in health && health.disable) || ("test" in health && Array.isArray(health.test) && health.test[0] === "NONE"));
    if (!definition.developmentOnly && !definition.onDemand) depends[context.serviceName] = { condition: health && !disabled ? "service_healthy" : "service_started" };
    for (const suffix of definition.volumes ?? []) model.volumes[context.volume(suffix)] = {};
  }
  const buildSecrets = [
    ...(config.build.npmrc ? [{ source: "ship_npmrc", target: "ship_npmrc" }] : []),
    ...(production ? config.build.secrets.map(key => ({ source: `ship_build_${key}`, target: `ship_build_${key}` })) : []),
  ];
  if (buildSecrets.length) model.secrets = Object.fromEntries(buildSecrets.map(({ source }) => [source,
    { file: resolve(root, ".ship-secrets", source === "ship_npmrc" ? "npmrc" : source.slice("ship_build_".length)) }]));
  if (!production) Object.assign(environmentVars, Object.fromEntries(Object.entries(config.build.publicEnv).map(([key, value]) => [key, value.replaceAll("$", "$$$$")])));
  const base = {
    ...(config.workspace ? { working_dir: `/app/${config.workspace.app}` } : {}),
    image: `${config.name}-app:${tag}`,
    init: true,
    ...(!production || plan.kind === "node" ? { environment: environmentVars } : {}),
    ...(plan.kind === "node" ? { env_file: [{ path: production ? ".env.production" : ".env", required: false }] } : {}),
    networks: ["ship", ...externalKeys],
    depends_on: depends,
    stop_grace_period: "60s",
    ...(production ? { restart: "unless-stopped" } : {}),
  };
  model.services[app] = {
    ...base,
    build: { context: resolve(root), dockerfile: "ship/Dockerfile", target: environment, ...(buildSecrets.length ? { secrets: buildSecrets } : {}), args: {
      ...(production ? Object.fromEntries(Object.entries(config.build.publicEnv).map(([key, value]) => [key, value.replaceAll("$", "$$$$")])) : {}),
      NODE_IMAGE: IMAGES[`node${config.node}` as keyof typeof IMAGES],
      SHIP_PACKAGE_MANAGER_VERSION: config.packageManagerVersion,
      SHIP_BUILD_SCRIPT: config.scripts.build ?? "",
      SHIP_UID: String(config.hostUser ? process.getuid?.() || 1000 : 1000), SHIP_GID: String(config.hostUser ? process.getgid?.() || 1000 : 1000),
    } },
    ...(!production && config.build.npmrc ? { secrets: [{ source: "ship_npmrc", target: "ship_npmrc" }] } : {}),
    command: composeCommand(production ? adapter.productionCommand(config) : adapter.developmentCommand(config)),
    ...(production ? {} : { volumes: [
      { type: "bind", source: resolve(root), target: "/app" },
      { type: "volume", source: "node_modules", target: "/app/node_modules" },
      ...workspacePackages.map(path => ({ type: "volume", source: `workspace_${createHash("sha256").update(path).digest("hex").slice(0, 16)}`, target: `/app/${path}/node_modules` })),
    ], extra_hosts: ["host.docker.internal:host-gateway"] }),
    ...(!production || config.publishPorts ? { ports: [`${production ? "" : "127.0.0.1:"}\${APP_PORT:-${config.port}}:${targetPort}`] } : {}),
  };
  if (!production) {
    model.volumes.node_modules = {};
    for (const path of workspacePackages) model.volumes[`workspace_${createHash("sha256").update(path).digest("hex").slice(0, 16)}`] = {};
  }
  if (production) for (const [name, value] of Object.entries(config.processes)) {
    const definition = processDefinition(value);
    const health = definition.healthcheck ?? (definition.http?.health ? `node -e ${JSON.stringify(`fetch('http://127.0.0.1:${definition.http.port}' + ${JSON.stringify(definition.http.health)}).then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))`)}` : null);
    model.services[name] = { ...base, command: composeCommand(commandArgv(definition.command)),
      ...(health ? { healthcheck: { test: ["CMD-SHELL", health.replaceAll("$", "$$$$")], interval: "10s", timeout: "5s", retries: 5, start_period: "10s" } } : {}),
      ...(definition.http ? { expose: [String(definition.http.port)] } : {}) };
  }
  return model;
}

export function render(model: ComposeModel): string { return `# Generated by JavaScript Ship; edit ship.json instead.\n${JSON.stringify(model, null, 2)}\n`; }

/** Resolve workspace membership before producing a Compose model. */
export async function buildProjectCompose(config: ShipConfig, root: string, environment: Environment, tag = "local", registry?: ExtensionRegistry): Promise<ComposeModel> {
  const selectedRegistry = registry ?? await loadExtensions(root, config.extensions);
  return buildCompose(config, root, environment, tag, await resolveWorkspace(config, root), selectedRegistry);
}
