import { portableServices } from "./portable-services.js";
import { frozenMap } from "./collections.js";
import { NAME } from "./config-rules.js";
import { ConfigError } from "./errors.js";
import { IMAGES } from "./images.js";
import { resolve } from "node:path";
import type { Environment, ServiceContext, ServiceDefinition, ShipConfig } from "./contracts.js";

export function serviceContext(environment: Environment, key: string, instance: string | null, serviceName: string, options: { config?: ShipConfig; projectRoot?: string } = {}): ServiceContext {
  const envPrefix = instance ? `${instance.toUpperCase()}_` : "";
  return Object.freeze({ config: options.config ?? null, projectRoot: options.projectRoot ?? null, environment, serviceName, resourceName: instance ? `${key}-${instance}` : key, envPrefix,
    volume(name: string): string {
      if (!NAME.test(name)) throw new ConfigError(["Service volume suffix must be a valid name."]);
      return `${instance ? `${key}-${instance}` : key}_${name}`;
    },
    credential(name: string, fallback: string): string {
      const variable = envPrefix + name;
      return environment === "production" ? `\${${variable}:?${variable} is required in .env.production}` : `\${${variable}:-${fallback}}`;
    },
    setting: (name: string, fallback: string) => `\${${envPrefix}${name}:-${fallback}}`,
  });
}

const healthcheck = (test: string[]) => ({ test, interval: "5s", timeout: "5s", retries: 20, start_period: "10s" });
export const postgres: ServiceDefinition = {
  key: "postgres", label: "PostgreSQL", group: "database", volumes: ["data"],
  compose: c => ({ image: IMAGES.postgres, environment: {
    POSTGRES_DB: c.setting("DB_NAME", "ship"), POSTGRES_USER: c.setting("DB_USER", "ship"), POSTGRES_PASSWORD: c.credential("DB_PASSWORD", "shipsecret"),
  }, volumes: [`${c.resourceName}_data:/var/lib/postgresql`],
  healthcheck: healthcheck(["CMD-SHELL", 'pg_isready -h 127.0.0.1 -U "$${POSTGRES_USER}" -d "$${POSTGRES_DB}"']), restart: "unless-stopped" }),
  appEnvironment: c => ({ [`${c.envPrefix}DB_HOST`]: c.serviceName, [`${c.envPrefix}DB_PORT`]: "5432", [`${c.envPrefix}DB_NAME`]: c.setting("DB_NAME", "ship"),
    [`${c.envPrefix}DB_USER`]: c.setting("DB_USER", "ship"), [`${c.envPrefix}DB_PASSWORD`]: c.credential("DB_PASSWORD", "shipsecret") }),
  databaseShell: () => ["sh", "-c", 'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'],
};
export const redis: ServiceDefinition = {
  key: "redis", label: "Redis", group: "cache", volumes: ["data"],
  compose: c => ({ image: IMAGES.redis, command: ["redis-server", "--appendonly", "yes"], volumes: [`${c.resourceName}_data:/data`],
    healthcheck: healthcheck(["CMD", "redis-cli", "ping"]), restart: "unless-stopped" }),
  appEnvironment: c => ({ [`${c.envPrefix}REDIS_URL`]: `redis://${c.serviceName}:6379/0` }),
};
export const mongodb: ServiceDefinition = {
  key: "mongodb", label: "MongoDB", group: "database", volumes: ["data", "config"],
  compose: c => ({ build: { context: resolve(c.projectRoot ?? "."), dockerfile: "ship/mongodb/Dockerfile" }, init: true,
    environment: { MONGO_INITDB_ROOT_USERNAME: c.setting("MONGODB_ROOT_USER", "shipadmin"), MONGO_INITDB_ROOT_PASSWORD: c.credential("MONGODB_ROOT_PASSWORD", "shiprootsecret"),
      MONGO_INITDB_DATABASE: c.setting("MONGODB_DATABASE", "ship"), SHIP_MONGO_USER: c.setting("MONGODB_USER", "ship"), SHIP_MONGO_PASSWORD: c.credential("MONGODB_PASSWORD", "shipsecret"),
      SHIP_MONGO_MODE: c.config?.mongodbMode ?? "replica-set", SHIP_MONGO_HOST: c.serviceName },
    volumes: [`${c.resourceName}_data:/data/db`, `${c.resourceName}_config:/data/configdb`], restart: "unless-stopped",
    healthcheck: { test: ["CMD", "mongosh", "--nodb", "--quiet", "/usr/local/share/ship-mongo-health.js"], interval: "3s", timeout: "10s", retries: 40, start_period: "30s" } }),
  appEnvironment: c => ({ [`${c.envPrefix}MONGODB_HOST`]: c.serviceName, [`${c.envPrefix}MONGODB_PORT`]: "27017",
    [`${c.envPrefix}MONGODB_DATABASE`]: c.setting("MONGODB_DATABASE", "ship"), [`${c.envPrefix}MONGODB_USER`]: c.setting("MONGODB_USER", "ship"),
    [`${c.envPrefix}MONGODB_PASSWORD`]: c.credential("MONGODB_PASSWORD", "shipsecret"), [`${c.envPrefix}MONGODB_REPLICA_SET`]: (c.config?.mongodbMode ?? "replica-set") === "replica-set" ? "rs0" : "",
    // Explicit empty overrides .env.production so the root password cannot leak via env_file.
    [`${c.envPrefix}MONGODB_ROOT_PASSWORD`]: "" }),
  databaseShell: () => ["sh", "-c", 'exec mongosh --host 127.0.0.1 --username "$SHIP_MONGO_USER" --password "$SHIP_MONGO_PASSWORD" --authenticationDatabase "$MONGO_INITDB_DATABASE" "$MONGO_INITDB_DATABASE"'],
};
export const builtinServices: ReadonlyMap<string, ServiceDefinition> = frozenMap(new Map([postgres, redis, mongodb, ...portableServices].map(service => [service.key, Object.freeze({ ...service, volumes: Object.freeze([...(service.volumes ?? [])]) })])));
