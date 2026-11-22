import { NAME, INSTANCE, RELATIVE_PATH, SCRIPT_NAME, BASE_PATH, NETWORK_NAME, ENV_NAME, PUBLIC_PREFIX, RESERVED } from "./config-rules.js";
import { EXACT_VERSION, DEFAULT_NPM_VERSION } from "./versions.js";
import { NODE_MINIMUMS } from "./images.js";
import type { ExtensionRegistry } from "./contracts.js";
import { builtinServices } from "./services.js";
import { builtinAdapters } from "./adapters.js";

const ref = (name: string) => ({ $ref: `#/definitions/${name}` });
const nullable = (schema: object) => ({ anyOf: [schema, { type: "null" }] });
const closed = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, properties });
const named = { type: "string", pattern: NAME.source };
const string = { type: "string", pattern: "^[^\\u0000]*$" };
const secretName = { type: "string", allOf: [ref("environmentName"), { not: { pattern: PUBLIC_PREFIX.source } }] };

/** Editor validation only; CLI validation also checks adapter, manifest and filesystem semantics. */
export function createConfigSchema(registry?: ExtensionRegistry): Record<string, unknown> {
  const adapters = registry?.adapters ?? builtinAdapters;
  const services = registry?.services ?? builtinServices;
  const groups = [...new Set([...services.values()].map(service => service.group))];
  const choices = (group: string) => [...services.values()].filter(service => service.group === group).map(service => service.key);
  return {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "JavaScript Ship configuration",
  description: "Docker development environments and portable production releases. Run ship config:test for project-aware checks.",
  ...closed({
    $schema: { type: "string", minLength: 1, pattern: "\\S", description: "Editor schema path or URL. Ship never fetches this value at runtime." },
    extensions: { type: "array", uniqueItems: true, default: [], items: { type: "string", allOf: [
      { pattern: `^(?:\\./)?${RELATIVE_PATH.source.slice(1)}` }, { pattern: "\\.(?:mjs|cjs|js)(?![\\s\\S])" },
    ] }, description: "Explicit trusted local JavaScript modules. Each default-exports an API-v1 extension or extension array." },
    workspace: { ...nullable({ ...closed({ app: ref("relativePath"), buildDependencies: { type: "array", uniqueItems: true, items: ref("relativePath"), default: [] } }), required: ["app"] }), default: null, description: "Select an app inside a root npm/pnpm/Yarn workspace; buildDependencies lists package paths built first, in order." },
    name: { ...named, description: "Project identity used in image, network and volume names. Defaults to the directory name." },
    framework: { type: "string", enum: [...adapters.keys()], default: "generic", description: "Framework adapter. Init detects built-ins from package.json; custom adapters are selected explicitly." },
    deployment: { type: "string", enum: ["node", "static"], description: "Runtime strategy. Supported modes depend on the framework adapter." },
    node: { type: "string", enum: Object.keys(NODE_MINIMUMS), default: "24", description: "Container Node major. Host and build images must meet the bundled runtime floors." },
    packageManager: { type: "string", enum: ["npm", "pnpm", "yarn"], default: "npm" },
    packageManagerVersion: { type: "string", pattern: EXACT_VERSION.source, examples: [DEFAULT_NPM_VERSION, "12.21.0", "4.18.1"], description: "Exact stable version; must match package.json when declared there." },
    scripts: { ...closed({ dev: ref("script"), build: nullable(ref("script")), start: nullable(ref("script")) }), description: "Names of package.json scripts, not shell commands." },
    port: { type: "integer", minimum: 1, maximum: 65535, default: 3000 },
    serverEntry: { ...nullable(ref("relativePath")), default: null, description: "Framework Node server entry relative to the app root." },
    runtimeFiles: { type: "array", items: ref("relativePath"), default: [], description: "Extra files required by isolated Node runtime packaging." },
    angularProject: { ...nullable(named), default: null },
    outputDirectory: { ...nullable(ref("relativePath")), default: null, description: "Framework build output relative to the app root." },
    staticRouting: { type: "string", enum: ["spa", "html"], default: "spa" },
    basePath: { type: "string", pattern: BASE_PATH.source, default: "/", examples: ["/", "/docs/"] },
    mongodbMode: { type: "string", enum: ["standalone", "replica-set"], default: "replica-set" },
    services: { ...closed(Object.fromEntries(groups.map(group => [group, { enum: choices(group) }]))), default: {} },
    additionalServices: { type: "array", default: [], items: {
      ...closed({ group: { enum: groups }, service: { enum: [...services.keys()] }, name: { type: "string", pattern: INSTANCE.source } }),
      required: ["group", "service", "name"],
      allOf: groups.map(group => ({ if: { properties: { group: { const: group } }, required: ["group"] }, then: { properties: { service: { enum: choices(group) } } } })),
    } },
    serviceNames: { type: "object", propertyNames: named, additionalProperties: named, default: {}, description: "Rename app or selected services; persistent resource identities stay stable." },
    externalNetwork: { ...nullable({ anyOf: [{ type: "string", pattern: NETWORK_NAME.source }, { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", pattern: NETWORK_NAME.source } }] }), default: null },
    publishPorts: { type: "boolean", default: false, description: "Publish production app ports. Development ports bind to loopback." },
    processes: { type: "object", propertyNames: { ...named, not: { enum: [...RESERVED] } }, additionalProperties: ref("process"), default: {}, description: "Production processes sharing the Node app image, with optional health and HTTP metadata." },
    deployCommands: { type: "array", items: ref("command"), default: [], description: "Commands run by the exported deployment script." },
    build: { ...closed({
      publicEnv: { type: "object", propertyNames: ref("environmentName"), additionalProperties: string, default: {}, description: "PUBLIC literal strings for builds and development. Never put credentials here." },
      secrets: { type: "array", uniqueItems: true, items: secretName, default: [], description: "Build-only environment names. Contents come from .ship-secrets/NAME; public framework prefixes are forbidden." },
      npmrc: { type: "boolean", default: false, description: "Mount .ship-secrets/npmrc for npm/pnpm dependency operations, never production runtime." },
    }), description: "Explicit public values and temporary build credentials; runtime .env files are excluded from builds." },
  }),
  allOf: [{
    if: { properties: { packageManager: { const: "yarn" } }, required: ["packageManager"] },
    then: { properties: {
      packageManagerVersion: { type: "string", allOf: [{ pattern: EXACT_VERSION.source }, { pattern: "^4\\." }] },
      build: { type: "object", properties: { npmrc: { const: false } } },
    } },
  }],
  definitions: {
    process: { anyOf: [ref("command"), { ...closed({ command: ref("command"), healthcheck: { type: "string", minLength: 1, pattern: "^(?=[\\s\\S]*\\S)[^\\u0000]*$" }, http: { ...closed({ port: { type: "integer", minimum: 1, maximum: 65535 }, role: { type: "string", minLength: 1 }, health: nullable({ type: "string", pattern: "^/[^\\r\\n\\u0000]*$" }), urlSetting: nullable({ type: "string", pattern: "^[A-Za-z_][A-Za-z0-9_]*$" }) }), required: ["port", "role"] } }), required: ["command"] }] },
    relativePath: { type: "string", pattern: RELATIVE_PATH.source, description: "Relative path without traversal, spaces or shell/config syntax." },
    script: { type: "string", pattern: SCRIPT_NAME.source },
    environmentName: { type: "string", pattern: ENV_NAME.source },
    command: { anyOf: [
      { type: "string", pattern: "^(?=[\\s\\S]*\\S)[^\\u0000]*$" },
      { type: "array", minItems: 1, items: [{ ...string, minLength: 1 }], additionalItems: string },
    ] },
  },
  };
}
export const shipConfigSchema = createConfigSchema();
