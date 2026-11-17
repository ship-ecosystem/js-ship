export type { Environment, Command, ShipConfig, ServiceContext, ServiceDefinition, FrameworkAdapter, PackagingPlan, PackageManagerName, ComposeModel, ProjectManifest, ShipExtension, ExtensionRegistry } from "./contracts.js";
export { ConfigError } from "./errors.js";
export { parseConfig, readConfig } from "./config.js";
export { buildCompose, buildProjectCompose, render } from "./compose.js";
export { serviceContext, builtinServices } from "./services.js";
export { builtinAdapters, detectFramework } from "./adapters.js";
export { packageManagers, scriptCommand } from "./package-managers.js";
export { shipConfigSchema, createConfigSchema } from "./schema.js";
export { createRegistry, loadExtensions } from "./extensions.js";
