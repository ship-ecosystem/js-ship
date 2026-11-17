import { readFile, access } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { ConfigError } from "./errors.js";
import type { Command, ProjectManifest, ShipConfig } from "./contracts.js";
import { DEFAULT_NPM_VERSION, EXACT_VERSION } from "./versions.js";

export const NAME = /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/;
export const INSTANCE = /^[a-z][a-z0-9_]*$/;
export const RESERVED = new Set(["init", "up", "down", "exec", "shell", "logs", "db", "config:test", "doctor", "build", "release", "npm", "pnpm", "app"]);
const FIELDS = new Set(["$schema", "framework", "deployment", "serverEntry", "runtimeFiles", "angularProject", "mongodbMode", "node", "name", "packageManager", "packageManagerVersion", "scripts", "port", "outputDirectory", "staticRouting", "basePath", "services", "additionalServices", "serviceNames", "externalNetwork", "publishPorts", "processes", "deployCommands"]);
export const safeRelativePath = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(value) && !value.split("/").some(p => p === "." || p === "..");
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
export async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
export async function readJson(path: string): Promise<unknown> {
  try { return JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, "")) as unknown; }
  catch (error) { throw new ConfigError([`Cannot read ${path}: ${(error as Error).message}`]); }
}

export async function readManifest(root: string): Promise<ProjectManifest> {
  const data = await readJson(resolve(root, "package.json"));
  if (!isObject(data)) throw new ConfigError(["package.json must contain an object."]);
  for (const key of ["scripts", "dependencies", "devDependencies"]) {
    if (data[key] !== undefined && (!isObject(data[key]) || Object.values(data[key]).some(v => typeof v !== "string"))) {
      throw new ConfigError([`package.json ${key} must map names to strings.`]);
    }
  }
  return data as ProjectManifest;
}

export function projectName(root: string): string {
  const value = basename(root).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^[^a-z]+/, "").replace(/[-_]+$/, "");
  return NAME.test(value) ? value : "ship-app";
}

export function parseConfig(data: unknown, root: string): ShipConfig {
  if (!isObject(data)) throw new ConfigError(["ship.json must contain an object."]);
  const problems: string[] = [];
  for (const key of Object.keys(data)) if (!FIELDS.has(key)) problems.push(`Unknown ship.json field: ${key}.`);
  const text = (key: string, fallback: string): string => {
    const value = data[key] ?? fallback;
    if (typeof value !== "string" || !value) { problems.push(`${key} must be a nonempty string.`); return fallback; }
    return value;
  };
  const framework = text("framework", "generic");
  const deployment = data.deployment ?? (["react", "vue", "svelte", "vitepress", "angular", "astro", "gatsby"].includes(framework) ? "static" : "node");
  if (deployment !== "node" && deployment !== "static") problems.push("deployment must be node or static.");
  const serverEntry = data.serverEntry ?? null;
  if (serverEntry !== null && !safeRelativePath(serverEntry)) problems.push("serverEntry must be a safe relative path.");
  const runtimeFiles = data.runtimeFiles ?? [];
  if (!Array.isArray(runtimeFiles) || runtimeFiles.some(value => !safeRelativePath(value))) problems.push("runtimeFiles must be an array of safe relative paths.");
  const angularProject = data.angularProject ?? null;
  if (angularProject !== null && (typeof angularProject !== "string" || !NAME.test(angularProject))) problems.push("angularProject must be a valid application name.");
  const mongodbMode = data.mongodbMode ?? "replica-set";
  if (mongodbMode !== "standalone" && mongodbMode !== "replica-set") problems.push("mongodbMode must be standalone or replica-set.");
  const node = text("node", "24");
  if (!/^(22|24|26)$/.test(node)) problems.push("node must be a supported major: 22, 24 or 26. Patch pins are not supported yet.");
  const name = text("name", projectName(root));
  if (!NAME.test(name)) problems.push("name must start with a lowercase letter and contain lowercase letters, digits, hyphens or underscores.");
  const packageManager = text("packageManager", "npm");
  if (!["npm", "pnpm"].includes(packageManager)) problems.push("packageManager must be npm or pnpm. Yarn and Bun are not implemented yet.");
  const packageManagerVersion = text("packageManagerVersion", packageManager === "npm" ? DEFAULT_NPM_VERSION : "");
  if (!EXACT_VERSION.test(packageManagerVersion)) problems.push("packageManagerVersion must be an exact stable version, such as 12.2.2.");
  let scripts = { dev: "dev", build: null as string | null, start: "start" as string | null };
  if (data.scripts !== undefined) {
    if (!isObject(data.scripts)) problems.push("scripts must be an object.");
    else {
      for (const key of Object.keys(data.scripts)) if (!["dev", "build", "start"].includes(key)) problems.push(`Unknown scripts field: ${key}.`);
      for (const key of ["dev", "build", "start"] as const) {
        const value = data.scripts[key];
        if (value === undefined) continue;
        if ((key === "build" || key === "start") && value === null) scripts[key] = null;
        else if (typeof value !== "string" || !/^[a-zA-Z0-9:_-]+$/.test(value)) problems.push(`scripts.${key} must name a package.json script${key !== "dev" ? " or be null" : ""}.`);
        else scripts = { ...scripts, [key]: value };
      }
    }
  }
  const port = data.port ?? 3000;
  if (!Number.isInteger(port) || (port as number) < 1 || (port as number) > 65535) problems.push("port must be an integer from 1 to 65535.");
  const outputDirectory = data.outputDirectory ?? null;
  // A Docker COPY source and nginx routing value must never contain shell/config syntax.
  if (outputDirectory !== null && !safeRelativePath(outputDirectory)) problems.push("outputDirectory must be a safe relative directory without traversal or spaces.");
  const staticRouting = data.staticRouting ?? "spa";
  if (staticRouting !== "spa" && staticRouting !== "html") problems.push("staticRouting must be spa or html.");
  const basePath = data.basePath ?? "/";
  if (typeof basePath !== "string" || !/^\/(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/)*$/.test(basePath)) problems.push("basePath must be / or a safe URL prefix with leading and trailing slashes, such as /docs/.");
  const stringMap = (key: string): Record<string, string> => {
    const value = data[key] ?? {};
    if (!isObject(value) || Object.entries(value).some(([k, v]) => !NAME.test(k) || typeof v !== "string" || !NAME.test(v))) {
      problems.push(`${key} must map valid names to valid names.`); return {};
    }
    return value as Record<string, string>;
  };
  const services = stringMap("services");
  const serviceNames = stringMap("serviceNames");
  const additionalServices: ShipConfig["additionalServices"] = [];
  if (data.additionalServices !== undefined && !Array.isArray(data.additionalServices)) problems.push("additionalServices must be an array.");
  else for (const item of (data.additionalServices ?? []) as unknown[]) {
    if (!isObject(item) || Object.keys(item).some(k => !["group", "service", "name"].includes(k)) ||
      typeof item.group !== "string" || !NAME.test(item.group) || typeof item.service !== "string" || !NAME.test(item.service) || typeof item.name !== "string" || !INSTANCE.test(item.name)) {
      problems.push("Each additionalServices entry needs a valid group, service and name.");
    } else additionalServices.push({ group: item.group, service: item.service, name: item.name });
  }
  if (new Set(additionalServices.map(s => s.name)).size !== additionalServices.length) problems.push("additionalServices names must be unique.");
  const command = (value: unknown): value is Command => (typeof value === "string" && !!value.trim() && !value.includes("\0")) ||
    (Array.isArray(value) && value.length > 0 && value.every(v => typeof v === "string" && !v.includes("\0")) && !!value[0]);
  const processes: Record<string, Command> = {};
  if (data.processes !== undefined && !isObject(data.processes)) problems.push("processes must be an object.");
  else for (const [key, value] of Object.entries(data.processes ?? {})) {
    if (!NAME.test(key) || RESERVED.has(key) || !command(value)) problems.push(`Invalid process ${key}: use a non-reserved name and a shell string or argument array.`);
    else processes[key] = value;
  }
  const deployCommands: Command[] = [];
  if (data.deployCommands !== undefined && !Array.isArray(data.deployCommands)) problems.push("deployCommands must be an array.");
  else for (const value of (data.deployCommands ?? []) as unknown[]) {
    if (!command(value)) problems.push("Each deployCommands entry must be a shell string or nonempty argument array.");
    else deployCommands.push(value);
  }
  const externalNetwork = data.externalNetwork ?? null;
  if (externalNetwork !== null && (typeof externalNetwork !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(externalNetwork))) problems.push("externalNetwork must be a Docker network name.");
  if (data.publishPorts !== undefined && typeof data.publishPorts !== "boolean") problems.push("publishPorts must be boolean.");
  if (problems.length) throw new ConfigError(problems);
  return { framework, deployment: deployment as ShipConfig["deployment"], serverEntry: serverEntry as string | null,
    runtimeFiles: runtimeFiles as string[], angularProject: angularProject as string | null, mongodbMode: mongodbMode as ShipConfig["mongodbMode"],
    node, name, packageManager: packageManager as ShipConfig["packageManager"], packageManagerVersion,
    scripts, outputDirectory: outputDirectory as string | null, staticRouting: staticRouting as ShipConfig["staticRouting"], basePath: basePath as string, port: port as number, services, additionalServices,
    serviceNames, externalNetwork: externalNetwork as string | null, publishPorts: data.publishPorts === true, processes, deployCommands };
}

export async function readConfig(root: string): Promise<ShipConfig> {
  return parseConfig(await readJson(resolve(root, "ship.json")), root);
}
