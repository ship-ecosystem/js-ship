export type Environment = "development" | "production";
export type Command = string | readonly string[];
export type Variables = Record<string, string>;
export type ComposeService = Record<string, unknown>;
export interface ComposeModel {
  name: string;
  services: Record<string, ComposeService>;
  volumes: Record<string, Record<string, never>>;
  networks: Record<string, Record<string, unknown>>;
  secrets?: Record<string, { file: string }>;
}

export interface AdditionalService { group: string; service: string; name: string }
export type PackageManagerName = "npm" | "pnpm" | "yarn";
export interface PackagingPlan {
  kind: "node" | "static";
  port: number;
  outputDirectory: string | null;
  routing: "spa" | "html";
  runtime?: "project" | "next" | "bundle";
  entrypoint?: string;
  runtimeDependencies?: boolean;
  spaFallback?: string;
}
export interface ShipConfig {
  extensions: string[];
  workspace: { app: string; buildDependencies: string[] } | null;
  build: { publicEnv: Record<string, string>; secrets: string[]; npmrc: boolean };
  framework: string;
  deployment: "node" | "static";
  serverEntry: string | null;
  runtimeFiles: string[];
  angularProject: string | null;
  mongodbMode: "standalone" | "replica-set";
  node: string;
  name: string;
  packageManager: PackageManagerName;
  packageManagerVersion: string;
  scripts: { dev: string; build: string | null; start: string | null };
  outputDirectory: string | null;
  staticRouting: "spa" | "html";
  basePath: string;
  port: number;
  services: Record<string, string>;
  additionalServices: AdditionalService[];
  serviceNames: Record<string, string>;
  externalNetwork: string | null;
  publishPorts: boolean;
  processes: Record<string, Command>;
  deployCommands: Command[];
}

/** Stable resourceName keeps volumes attached when a Compose service is renamed. */
export interface ServiceContext {
  readonly config: ShipConfig | null;
  readonly projectRoot: string | null;
  readonly environment: Environment;
  readonly serviceName: string;
  readonly resourceName: string;
  readonly envPrefix: string;
  volume(name: string): string;
  credential(name: string, developmentDefault: string): string;
  setting(name: string, fallback: string): string;
}

export interface ServiceDefinition {
  readonly key: string;
  readonly label: string;
  readonly group: string;
  readonly volumes?: readonly string[];
  compose(context: ServiceContext): ComposeService;
  appEnvironment(context: ServiceContext): Variables;
  databaseShell?(context: ServiceContext): readonly string[];
}

export interface ProjectManifest {
  type?: string;
  scripts?: Record<string, string>;
  packageManager?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: unknown;
}

/** Adapters return commands and packaging requirements; core owns Docker execution. */
export interface FrameworkAdapter {
  readonly key: string;
  readonly label: string;
  readonly defaultDeployment?: "node" | "static";
  defaults(manifest: ProjectManifest, deployment?: "node" | "static"): Pick<ShipConfig, "scripts" | "port" | "outputDirectory" | "staticRouting">;
  validate(config: ShipConfig, manifest: ProjectManifest): string[];
  packaging(config: ShipConfig): PackagingPlan;
  developmentCommand(config: ShipConfig): readonly string[];
  productionCommand(config: ShipConfig): readonly string[];
  buildArguments?(config: ShipConfig): readonly string[];
}

/** Versioned, synchronous planning contract. Loading a module executes trusted host code. */
export interface ShipExtension {
  readonly apiVersion: 1;
  readonly name: string;
  readonly version: string;
  readonly adapters?: readonly FrameworkAdapter[];
  readonly services?: readonly ServiceDefinition[];
  /** Text files published under ship/extensions/NAME/. */
  readonly templates?: Readonly<Record<string, string>>;
}
export interface ExtensionRegistry {
  readonly adapters: ReadonlyMap<string, FrameworkAdapter>;
  readonly services: ReadonlyMap<string, ServiceDefinition>;
  readonly extensions: readonly { readonly name: string; readonly version: string }[];
  readonly templates: Readonly<Record<string, string>>;
  readonly fingerprint: string;
}
