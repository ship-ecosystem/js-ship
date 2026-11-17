import { frozenMap } from "./collections.js";
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { builtinAdapters } from "./adapters.js";
import { builtinServices } from "./services.js";
import { NAME } from "./config-rules.js";
import { parseConfig, safeRelativePath } from "./config.js";
import { ConfigError } from "./errors.js";
import type { ExtensionRegistry, FrameworkAdapter, ServiceDefinition, ShipExtension, PackagingPlan } from "./contracts.js";

const importedSources = new Map<string, string>();
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
function fail(message: string): never { throw new ConfigError([`Extension: ${message}`]); }
function strings(value: unknown, label: string, command = false): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== "string" || item.includes("\0")) || (command && (!value.length || !value[0]))) fail(`${label} must return ${command ? "a nonempty command" : "an array of strings"}.`);
  return value as string[];
}
function hooks(value: Record<string, unknown>, names: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(names.filter(name => typeof value[name] === "function").map(name => [name, (value[name] as (...args: unknown[]) => unknown).bind(value)]));
}
function adapter(value: unknown): FrameworkAdapter {
  if (!object(value) || typeof value.key !== "string" || !NAME.test(value.key) || typeof value.label !== "string" || !value.label.trim()) fail("adapters need a valid key and label.");
  for (const key of ["defaults", "validate", "packaging", "developmentCommand", "productionCommand"]) if (typeof value[key] !== "function") fail(`adapter ${value.key} needs ${key}().`);
  if (value.buildArguments !== undefined && typeof value.buildArguments !== "function") fail(`adapter ${value.key} buildArguments must be a function.`);
  if (value.defaultDeployment !== undefined && value.defaultDeployment !== "node" && value.defaultDeployment !== "static") fail(`adapter ${value.key} has an invalid defaultDeployment.`);
  const definition = Object.freeze({ ...value, key: value.key, label: value.label,
    ...(value.defaultDeployment !== undefined ? { defaultDeployment: value.defaultDeployment } : {}),
    ...hooks(value, ["defaults", "validate", "packaging", "developmentCommand", "productionCommand", "buildArguments"]) }) as unknown as FrameworkAdapter;
  return Object.freeze<FrameworkAdapter>({ ...definition,
    defaults(manifest, deployment) {
      const result = definition.defaults(manifest, deployment);
      if (!object(result) || ["scripts", "port", "outputDirectory", "staticRouting"].some(key => !Object.hasOwn(result, key)) || Object.keys(result).some(key => !["scripts", "port", "outputDirectory", "staticRouting"].includes(key))) fail(`adapter ${definition.key} returned invalid defaults.`);
      const normalized = parseConfig(result, "/extension");
      return { scripts: normalized.scripts, port: normalized.port, outputDirectory: normalized.outputDirectory, staticRouting: normalized.staticRouting };
    },
    validate: (config, manifest) => strings(definition.validate(config, manifest), `${definition.key}.validate()`),
    packaging(config) {
      const result = definition.packaging(config);
      if (!object(result) || !["node", "static"].includes(String(result.kind)) || !Number.isInteger(result.port) || Number(result.port) < 1 || Number(result.port) > 65535 || !["spa", "html"].includes(String(result.routing))) fail(`adapter ${definition.key} returned invalid packaging.`);
      if (result.kind !== config.deployment) fail(`adapter ${definition.key} packaging kind must match deployment.`);
      if (Object.keys(result).some(key => !["kind", "port", "outputDirectory", "routing", "runtime", "entrypoint", "runtimeDependencies", "spaFallback"].includes(key))) fail(`adapter ${definition.key} returned unknown packaging fields.`);
      if (result.outputDirectory !== null && !safeRelativePath(result.outputDirectory)) fail(`adapter ${definition.key} outputDirectory must be null or a safe relative path.`);
      if (result.runtime !== undefined && !["project", "bundle"].includes(String(result.runtime))) fail(`adapter ${definition.key} supports project or bundle runtime only.`);
      if (result.entrypoint !== undefined && !safeRelativePath(result.entrypoint)) fail(`adapter ${definition.key} has an unsafe entrypoint.`);
      if (result.spaFallback !== undefined && !safeRelativePath(result.spaFallback)) fail(`adapter ${definition.key} has an unsafe spaFallback.`);
      if (result.runtimeDependencies !== undefined && typeof result.runtimeDependencies !== "boolean") fail(`adapter ${definition.key} runtimeDependencies must be boolean.`);
      if (result.kind === "static" && (result.port !== 8080 || !result.outputDirectory)) fail(`adapter ${definition.key} static output needs a directory and port 8080.`);
      if (result.runtime === "bundle" && (!result.outputDirectory || !result.entrypoint?.startsWith(`${result.outputDirectory}/`))) fail(`adapter ${definition.key} bundle entrypoint must be inside its output directory.`);
      return result as unknown as PackagingPlan;
    },
    developmentCommand: config => strings(definition.developmentCommand(config), `${definition.key}.developmentCommand()`, true),
    productionCommand: config => strings(definition.productionCommand(config), `${definition.key}.productionCommand()`, true),
    ...(definition.buildArguments ? { buildArguments: (config: Parameters<FrameworkAdapter["packaging"]>[0]) => strings(definition.buildArguments!(config), `${definition.key}.buildArguments()`) } : {}),
  });
}
function service(value: unknown): ServiceDefinition {
  if (!object(value) || typeof value.key !== "string" || !NAME.test(value.key) || typeof value.group !== "string" || !NAME.test(value.group) || typeof value.label !== "string" || !value.label.trim()) fail("services need valid key/group names and a label.");
  for (const key of ["compose", "appEnvironment"]) if (typeof value[key] !== "function") fail(`service ${value.key} needs ${key}().`);
  if (value.databaseShell !== undefined && typeof value.databaseShell !== "function") fail(`service ${value.key} databaseShell must be a function.`);
  const volumes = value.volumes ?? [];
  if (!Array.isArray(volumes) || volumes.some(name => typeof name !== "string" || !NAME.test(name)) || new Set(volumes).size !== volumes.length) fail(`service ${value.key} volumes must list unique suffix names.`);
  const definition = Object.freeze({ ...value, key: value.key, label: value.label, group: value.group, volumes: Object.freeze([...volumes]),
    ...hooks(value, ["compose", "appEnvironment", "databaseShell"]) }) as unknown as ServiceDefinition;
  return Object.freeze<ServiceDefinition>({ ...definition,
    compose(context) {
      const result = definition.compose(context);
      if (!object(result) || (!result.build && (typeof result.image !== "string" || !/^[A-Za-z0-9_./:@-]+(?![\s\S])/.test(result.image)))) fail(`service ${definition.key} must return a Compose object with a literal image or build.`);
      try {
        const serialized: unknown = JSON.parse(JSON.stringify(result));
        if (!object(serialized)) fail(`service ${definition.key} must serialize to a Compose object.`);
        return serialized;
      } catch { fail(`service ${definition.key} returned a non-JSON Compose fragment.`); }
    },
    appEnvironment(context) {
      const result = definition.appEnvironment(context);
      if (!object(result) || Object.entries(result).some(([key, value]) => !/^[A-Za-z_][A-Za-z0-9_]*(?![\s\S])/.test(key) || typeof value !== "string" || value.includes("\0"))) fail(`service ${definition.key} appEnvironment must map environment names to strings.`);
      return result;
    },
    ...(definition.databaseShell ? { databaseShell: (context: Parameters<ServiceDefinition["compose"]>[0]) => strings(definition.databaseShell!(context), `${definition.key}.databaseShell()`, true) } : {}),
  });
}
export function createRegistry(extensions: readonly ShipExtension[] = [], sourceFingerprint = ""): ExtensionRegistry {
  const adapters = new Map<string, FrameworkAdapter>([...builtinAdapters].map(([key, value]) => [key, Object.freeze({ ...value })]));
  const services = new Map<string, ServiceDefinition>([...builtinServices].map(([key, value]) => [key, Object.freeze({ ...value, volumes: Object.freeze([...(value.volumes ?? [])]) })]));
  const names = new Set<string>(), templates: Record<string, string> = {}, identities: { name: string; version: string }[] = [];
  for (const extension of extensions) {
    if (!object(extension) || extension.apiVersion !== 1) fail("apiVersion must be 1.");
    if (typeof extension.name !== "string" || !NAME.test(extension.name) || names.has(extension.name)) fail("extension names must be valid and unique.");
    if (typeof extension.version !== "string" || !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)?(?:\+[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)?(?![\s\S])/.test(extension.version)) fail(`${extension.name} needs a semantic version.`);
    if (Object.keys(extension).some(key => !["apiVersion", "name", "version", "adapters", "services", "templates"].includes(key))) fail(`${extension.name} has unknown extension fields.`);
    names.add(extension.name); identities.push(Object.freeze({ name: extension.name, version: extension.version }));
    for (const [key, validate, map] of [["adapters", adapter, adapters], ["services", service, services]] as const) {
      const values = extension[key] ?? [];
      if (!Array.isArray(values)) fail(`${extension.name}.${key} must be an array.`);
      for (const value of values) {
        const checked = validate(value);
        if (map.has(checked.key)) fail(`duplicate ${key} key ${checked.key}; built-ins cannot be replaced.`);
        // The branch-specific validators preserve the map's value type.
        if (key === "adapters") adapters.set(checked.key, checked as FrameworkAdapter);
        else services.set(checked.key, checked as ServiceDefinition);
      }
    }
    if (extension.templates !== undefined && !object(extension.templates)) fail(`${extension.name}.templates must map relative filenames to text.`);
    for (const [path, contents] of Object.entries(extension.templates ?? {})) {
      if (!safeRelativePath(path) || typeof contents !== "string" || contents.includes("\0")) fail(`${extension.name} has an unsafe template filename or non-text contents.`);
      templates[`extensions/${extension.name}/${path}`] = contents.replace(/\r\n/g, "\n");
    }
  }
  const contracts = { adapters: [...adapters.values()].map(value => [value.key, value.label, value.defaultDeployment ?? null]),
    services: [...services.values()].map(value => [value.key, value.label, value.group, value.volumes ?? []]) };
  const fingerprint = createHash("sha256").update(JSON.stringify({ identities, templates, sourceFingerprint, contracts })).digest("hex");
  return Object.freeze({ adapters: frozenMap(adapters), services: frozenMap(services), extensions: Object.freeze(identities), templates: Object.freeze(templates), fingerprint });
}
export async function loadExtensions(root: string, modules: readonly string[] = []): Promise<ExtensionRegistry> {
  const normalized = parseConfig({ extensions: modules }, root).extensions;
  const definitions: ShipExtension[] = [], sources: string[] = [];
  for (const entry of normalized) {
    const path = resolve(root, entry);
    try {
      const actual = await realpath(path), inside = relative(await realpath(root), actual);
      if (inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) fail(`${entry} resolves outside the project root.`);
      const text = (await readFile(actual, "utf8")).replace(/\r\n/g, "\n");
      const hash = createHash("sha256").update(text).digest("hex");
      if (importedSources.has(actual) && importedSources.get(actual) !== hash) fail(`${entry} changed after import; restart this process before reloading extensions.`);
      sources.push(entry, hash);
      importedSources.set(actual, hash);
      const imported = await import(pathToFileURL(actual).href) as { default?: unknown };
      const values = Array.isArray(imported.default) ? imported.default : [imported.default];
      definitions.push(...values as ShipExtension[]);
    } catch (error) { throw new ConfigError([`Cannot load extension ${entry}: ${(error as Error).message}`]); }
  }
  return createRegistry(definitions, JSON.stringify(sources));
}
