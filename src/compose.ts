import { resolve } from "node:path";
import type { Command, ComposeModel, Environment, ServiceContext, ServiceDefinition, ShipConfig } from "./contracts.js";
import { adapterFor } from "./adapters.js";
import { ConfigError } from "./errors.js";
import { builtinServices, serviceContext } from "./services.js";

export function commandArgv(command: Command): string[] {
  return typeof command === "string" ? ["sh", "-c", command] : [...command];
}
/** Only literal commands need escaping. Service environment already contains Compose expressions. */
export function composeCommand(command: readonly string[]): string[] { return command.map(arg => arg.replaceAll("$", () => "$$")); }

export interface Selection { definition: ServiceDefinition; context: ServiceContext }
export function selections(config: ShipConfig, environment: Environment, root?: string): Selection[] {
  const entries = [
    ...Object.entries(config.services).map(([group, service]) => ({ group, service, name: null })),
    ...config.additionalServices,
  ];
  return entries.map(entry => {
    const definition = builtinServices.get(entry.service);
    if (!definition || definition.group !== entry.group) throw new ConfigError([`Unknown ${entry.group} service ${entry.service}. Available: postgres/mongodb (database), redis (cache).`]);
    const resource = entry.name ? `${entry.service}-${entry.name}` : entry.service;
    return { definition, context: serviceContext(environment, entry.service, entry.name, config.serviceNames[resource] ?? resource, { config, ...(root ? { projectRoot: root } : {}) }) };
  });
}

export function buildCompose(config: ShipConfig, root: string, environment: Environment, tag = "local"): ComposeModel {
  const production = environment === "production";
  const selected = selections(config, environment, root);
  const adapter = adapterFor(config);
  const plan = adapter.packaging(config);
  if (plan.kind === "static" && (Object.keys(config.processes).length || config.deployCommands.length)) throw new ConfigError(["Static images cannot run Node workers or deploy commands. Use a backend Ship project."]);
  const targetPort = production ? plan.port : config.port;
  const app = config.serviceNames.app ?? "app";
  const validRenames = new Set(["app", ...selected.map(s => s.context.resourceName)]);
  const problems: string[] = [];
  for (const key of Object.keys(config.serviceNames)) if (!validRenames.has(key)) problems.push(`serviceNames refers to absent service ${key}.`);
  const names = [app, ...selected.map(s => s.context.serviceName), ...Object.keys(config.processes)];
  if (new Set(names).size !== names.length) problems.push("App, service and process names collide after serviceNames renaming.");
  if (problems.length) throw new ConfigError(problems);
  const networks: Record<string, Record<string, unknown>> = { ship: {} };
  if (config.externalNetwork) networks.external = { external: true, name: config.externalNetwork };
  const model: ComposeModel = { name: config.name + (production ? "-production" : ""), services: {}, volumes: {}, networks };
  const environmentVars: Record<string, string> = { NODE_ENV: production ? "production" : "development", HOST: "0.0.0.0", PORT: String(config.port) };
  if (config.framework === "next" && plan.kind === "node") environmentVars.HOSTNAME = "0.0.0.0";
  if (config.framework === "angular" && !production) environmentVars.NG_ALLOWED_HOSTS = "${NG_ALLOWED_HOSTS:-localhost,127.0.0.1}";
  const depends: Record<string, { condition: string }> = {};
  for (const { definition, context } of selected) {
    const fragment = definition.compose(context);
    model.services[context.serviceName] = { ...fragment, ...(fragment.build ? { image: `${config.name}-${definition.key}:${tag}` } : {}), networks: ["ship"] };
    if (plan.kind === "node") Object.assign(environmentVars, definition.appEnvironment(context));
    depends[context.serviceName] = { condition: "service_healthy" };
    model.volumes[`${context.resourceName}_data`] = {};
    if (definition.key === "mongodb") model.volumes[`${context.resourceName}_config`] = {};
  }
  const base = {
    image: `${config.name}-app:${tag}`,
    init: true,
    ...(!production || plan.kind === "node" ? { environment: environmentVars } : {}),
    ...(plan.kind === "node" ? { env_file: [{ path: production ? ".env.production" : ".env", required: false }] } : {}),
    networks: config.externalNetwork ? ["ship", "external"] : ["ship"],
    depends_on: depends,
    stop_grace_period: "60s",
    ...(production ? { restart: "unless-stopped" } : {}),
  };
  model.services[app] = {
    ...base,
    build: { context: resolve(root), dockerfile: "ship/Dockerfile", target: environment, args: {
      NODE_VERSION: config.node,
      SHIP_PACKAGE_MANAGER_VERSION: config.packageManagerVersion,
      SHIP_BUILD_SCRIPT: config.scripts.build ?? "",
      SHIP_UID: String(process.getuid?.() || 1000), SHIP_GID: String(process.getgid?.() || 1000),
    } },
    command: composeCommand(production ? adapter.productionCommand(config) : adapter.developmentCommand(config)),
    ...(production ? {} : { volumes: [
      { type: "bind", source: resolve(root), target: "/app" },
      { type: "volume", source: "node_modules", target: "/app/node_modules" },
    ], extra_hosts: ["host.docker.internal:host-gateway"] }),
    ...(!production || config.publishPorts ? { ports: [`${production ? "" : "127.0.0.1:"}\${APP_PORT:-${config.port}}:${targetPort}`] } : {}),
  };
  if (!production) model.volumes.node_modules = {};
  if (production) for (const [name, command] of Object.entries(config.processes)) {
    model.services[name] = { ...base, command: composeCommand(commandArgv(command)) };
  }
  return model;
}

export function render(model: ComposeModel): string { return `# Generated by JavaScript Ship; edit ship.json instead.\n${JSON.stringify(model, null, 2)}\n`; }
