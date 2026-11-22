import { SERVICE_IMAGES } from "./service-images.js";
import { resolve } from "node:path";
import { portableServiceData } from "./portable-service-data.js";
import type { ComposeService, ServiceContext, ServiceDefinition } from "./contracts.js";
import { ConfigError } from "./errors.js";

/** PHP and JS share these server-side protocols; no language library is installed. */
function portable(key: string): ServiceDefinition {
  const data = portableServiceData[key]!;
  const template = Object.values(data.dev)[0]!;
  const originalName = Object.keys(data.dev)[0]!;
  const mounts = (template.volumes ?? []) as string[];
  const owned = mounts.filter(value => value.startsWith("ship-")).map(value => value.split(":")[0]!);
  const endpoints: Record<string, { port: number; role: string; health: string | null }[]> = {
    seaweedfs: [{ port: 8333, role: "storage", health: null }], garage: [{ port: 3900, role: "storage", health: null }],
    rustfs: [{ port: 9000, role: "storage", health: "/health" }], silo: [{ port: 9000, role: "storage", health: "/minio/health/live" }, { port: 9001, role: "dashboard", health: null }],
    meilisearch: [{ port: 7700, role: "search", health: "/health" }], elasticsearch: [{ port: 9200, role: "search", health: null }], typesense: [{ port: 8108, role: "search", health: "/health" }],
    mailpit: [{ port: 8025, role: "dashboard", health: null }], rabbitmq: [{ port: 15672, role: "dashboard", health: null }],
  };
  const http = data.http.length ? data.http : endpoints[key] ?? [];
  const suffixes = owned.map(name => name.slice(name.lastIndexOf("-") + 1));
  const replace = (value: unknown, c: ServiceContext): unknown => {
    if (typeof value === "string") {
      let result = value.replaceAll("SHIP_PLACEHOLDER_", c.envPrefix).replaceAll(originalName, c.serviceName);
      for (let i = 0; i < owned.length; i++) result = result.replaceAll(owned[i]!.replaceAll(originalName, c.serviceName), c.volume(suffixes[i]!));
      return result;
    }
    if (Array.isArray(value)) return value.map(v => replace(v, c));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [String(replace(k, c)), replace(v, c)]));
    return value;
  };
  return {
    key, label: data.label, group: data.group, volumes: key === "cypress" ? ["node-modules", "app-modules"] : suffixes,
    ...(Object.keys(data.prod).length === 0 ? { developmentOnly: true } : {}),
    ...(key === "cypress" ? { onDemand: true } : {}),
    compose(c) {
      const source = c.environment === "production" ? Object.values(data.prod)[0] : template;
      const result = replace(source ?? template, c) as ComposeService;
      if (key === "playwright") result.command = ["npx", "-y", `playwright@${SERVICE_IMAGES.playwright.match(/:v([0-9.]+)-/)![1]}`, "run-server", "--host", "0.0.0.0", "--port", "3000"];
      if (key === "garage") result.build = { context: resolve(c.projectRoot ?? ".", "ship/garage"), dockerfile: "Dockerfile", args: { GARAGE_RPC_PUBLIC_ADDR: `${c.serviceName}:3901` } };
      if (key === "silo" && c.config?.siloImage === "distroless") result.image = SERVICE_IMAGES.silodistroless;
      if (key === "centrifugo") {
        const cache = c.config?.services.cache;
        if (cache && ["redis", "valkey"].includes(cache)) {
          const host = c.config?.serviceNames[cache] ?? cache;
          (result.environment as Record<string, string>).CENTRIFUGO_ENGINE_REDIS_ADDRESS = c.setting("CENTRIFUGO_REDIS_ADDRESS", `redis://${host}:6379`);
        }
      }
      if (key === "mailpit" && !c.envPrefix) result.ports = [`127.0.0.1:${c.setting("MAILPIT_WEB_PORT", "8025")}:8025`];
      if (key === "cypress") {
        result.working_dir = c.config?.workspace ? `/e2e/${c.config.workspace.app}` : "/e2e";
        result.environment = { CYPRESS_BASE_URL: appUrl(c) };
        result.volumes = [{ type: "bind", source: c.projectRoot ?? ".", target: "/e2e" },
          { type: "volume", source: c.volume("node-modules"), target: "/e2e/node_modules" },
          ...(c.config?.workspace ? [{ type: "volume", source: c.volume("app-modules"), target: `/e2e/${c.config.workspace.app}/node_modules` }] : [])];
      }
      // Development dashboards bind loopback. Production uses external HTTP routing
      // unless the project explicitly opts into publishing ports.
      if (c.environment === "production" && !c.config?.publishPorts) delete result.ports;
      result.restart ??= "unless-stopped";
      return result;
    },
    appEnvironment(c) {
      if (c.environment === "production" && data.group === "testing") return {};
      const env = replace(data.env, c) as Record<string, string>;
      const prod = JSON.stringify(replace(Object.values(data.prod)[0] ?? {}, c));
      const required = [...prod.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*):\?/g)].map(m => m[1]!);
      for (const [name, value] of Object.entries(env)) env[name] = value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*):-([^}]*)\}/g, (expr, variable: string, fallback: string) => required.includes(variable) ? c.credential(variable.slice(c.envPrefix.length), fallback) : expr);
      // Never hand database admin credentials to the app via its env_file.
      if (data.group === "database") env[`${c.envPrefix}DB_ROOT_PASSWORD`] = "";
      if (key === "playwright") env.PLAYWRIGHT_BASE_URL = appUrl(c);
      if (key === "centrifugo") {
        delete env.VITE_CENTRIFUGO_URL;
        if (c.environment === "development") env[publicUrlSetting(c)] = `ws://localhost:${c.setting("CENTRIFUGO_PORT", "8001")}/connection/websocket`;
      }
      return env;
    },
    ...(data.shell ? { databaseShell: () => [...data.shell!] } : {}),
    ...(http.length ? { http: (c: ServiceContext) => http.map(entry => ({ ...entry, ...(key === "centrifugo" ? { urlSetting: publicUrlSetting(c) } : {}) })) } : {}),
  };
}
function publicUrlSetting(c: ServiceContext): string {
  const framework = c.config?.framework;
  const prefix = framework === "next" ? "NEXT_PUBLIC_" : framework === "nuxt" ? "NUXT_PUBLIC_" : framework === "gatsby" ? "GATSBY_" : ["astro", "sveltekit"].includes(framework ?? "") ? "PUBLIC_" : "VITE_";
  return `${prefix}CENTRIFUGO_URL`;
}
function appUrl(c: ServiceContext): string { return `http://${c.config?.serviceNames.app ?? "app"}:${c.config?.port ?? 3000}`; }
const selenium: ServiceDefinition = {
  key: "selenium", label: "Selenium WebDriver (Chromium)", group: "testing", developmentOnly: true,
  compose: () => ({ image: SERVICE_IMAGES.selenium, shm_size: "2gb", init: true,
    healthcheck: { test: ["CMD-SHELL", "/opt/bin/check-grid.sh --host 0.0.0.0 --port 4444"], interval: "5s", timeout: "10s", retries: 20, start_period: "20s" } }),
  appEnvironment: c => c.environment === "development" ? { SELENIUM_REMOTE_URL: `http://${c.serviceName}:4444`, WEBDRIVER_BASE_URL: appUrl(c) } : {},
};
const bullBoard: ServiceDefinition = {
  key: "bull-board", label: "Bull Board queue dashboard", group: "queue-dashboard",
  compose(c) {
    const cache = c.config?.services.cache;
    if (!cache || !["redis", "valkey"].includes(cache)) throw new ConfigError(["Bull Board needs a Redis or Valkey cache. Configure services.cache first."]);
    const host = c.config?.serviceNames[cache] ?? cache;
    return { image: SERVICE_IMAGES.bullboard, command: ["--redis", `redis://${host}:6379`], environment: {
      BULL_BOARD_HOST: "0.0.0.0", BULL_BOARD_READ_ONLY: c.setting("BULL_BOARD_READ_ONLY", c.environment === "production" ? "true" : "false"), BULL_BOARD_PREFIX: c.setting("BULL_BOARD_PREFIX", "bull"), BULL_BOARD_BASE_PATH: c.setting("BULL_BOARD_BASE_PATH", "/"), BULL_BOARD_USER: c.setting("BULL_BOARD_USER", "ship"), BULL_BOARD_PASSWORD: c.credential("BULL_BOARD_PASSWORD", "shipsecret"),
    }, ...(c.environment === "development" ? { ports: [`127.0.0.1:${c.setting("BULL_BOARD_PORT", "3001")}:3000`] } : {}), restart: "unless-stopped", depends_on: { [host]: { condition: "service_healthy" } } };
  },
  appEnvironment: () => ({}),
  http: () => [{ port: 3000, role: "dashboard", health: null, urlSetting: "BULL_BOARD_URL" }],
};
export const portableServices: readonly ServiceDefinition[] = [...Object.keys(portableServiceData).map(portable), selenium, bullBoard];
