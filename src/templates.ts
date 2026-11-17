import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { adapterFor } from "./adapters.js";
import type { ShipConfig } from "./contracts.js";
import { exists, readJson } from "./config.js";
import { packageManagers } from "./package-managers.js";

const quote = (arg: string): string => `'${arg.replaceAll("'", "'\\''")}'`;
const shell = (args: readonly string[]): string => args.map(quote).join(" ");
export function templateSettings(config: ShipConfig): Record<string, unknown> {
  const plan = adapterFor(config).packaging(config);
  return { format: 4, packageManager: config.packageManager, framework: config.framework, deployment: config.deployment,
    kind: plan.kind, outputDirectory: plan.outputDirectory, routing: plan.routing, basePath: config.basePath,
    entrypoint: plan.entrypoint ?? null, runtimeFiles: JSON.stringify(config.runtimeFiles), angularProject: config.angularProject,
    ...(config.framework === "gatsby" ? { gatsbyStaticHeaders: 1 } : {}),
    ...(config.framework === "next" && plan.kind === "static" ? { nextStaticRouting: 1 } : {}) };
}
export async function templateProblems(config: ShipConfig, root: string): Promise<string[]> {
  if (!(await exists(resolve(root, "ship/Dockerfile")))) return [];
  const marker = resolve(root, "ship/.ship-template.json");
  if (!(await exists(marker))) return ["Existing Docker templates predate packaging metadata. Review your edits, then run ship init --force to publish current templates."];
  const settings = await readJson(marker);
  const expected = templateSettings(config);
  return settings !== null && typeof settings === "object" && Object.entries(expected).every(([key, value]) => (settings as Record<string, unknown>)[key] === value) ? []
    : ["Docker templates were generated for different packaging settings. Review your edits, then run ship init --force."];
}

export async function renderTemplates(config: ShipConfig): Promise<Record<string, string>> {
  const adapter = adapterFor(config);
  const plan = adapter.packaging(config);
  const manager = packageManagers[config.packageManager];
  const setup = `ARG SHIP_PACKAGE_MANAGER_VERSION\nRUN if command -v corepack >/dev/null 2>&1; then corepack disable; fi\nRUN test -n "$SHIP_PACKAGE_MANAGER_VERSION" && npm install --global --engine-strict "${config.packageManager}@$SHIP_PACKAGE_MANAGER_VERSION" --no-audit --no-fund\nENV CI=true`;
  const production = plan.kind === "node"
    ? `FROM base AS production\nENV NODE_ENV=production\nCOPY --from=builder --chown=node:node ${plan.runtime && plan.runtime !== "project" ? "/opt/ship-runtime" : "/app"} /app\nCOPY ship/app-entrypoint.mjs /usr/local/bin/ship-app-entrypoint.mjs\nUSER node\nENTRYPOINT ["node", "/usr/local/bin/ship-app-entrypoint.mjs"]`
    : `FROM nginxinc/nginx-unprivileged:stable-alpine AS production\nCOPY ship/nginx.conf /etc/nginx/conf.d/default.conf\nCOPY --from=builder /app/${plan.outputDirectory}/ /usr/share/nginx/html${config.basePath}\nUSER 101:101\nEXPOSE 8080`;
  const source = await readFile(new URL("../templates/Dockerfile", import.meta.url), "utf8");
  const extra = adapter.buildArguments?.(config) ?? (plan.kind === "static" ? ["--base", config.basePath] : []);
  const extraText = extra.length ? `${config.packageManager === "npm" ? " --" : ""} ${shell(extra)}` : "";
  const replacements: Record<string, string> = {
    "@PACKAGE_MANAGER_SETUP@": setup, "@LOCKFILE@": manager.lockfile,
    "@INSTALL@": shell(manager.install),
    "@BUILD_PREPARE@": `${["nuxt", "tanstack-start"].includes(config.framework) && plan.kind === "node" ? "ENV NITRO_PRESET=node-server\n" : ""}RUN node ship/prepare-output.mjs --clean`,
    "@BUILD@": `if [ -n "$SHIP_BUILD_SCRIPT" ]; then ${config.packageManager} run "$SHIP_BUILD_SCRIPT"${extraText}; fi`,
    "@BUILDER_FINISH@": `${plan.kind === "node" ? `RUN ${shell(manager.prune)}\n` : ""}RUN node ship/prepare-output.mjs`,
    "@PRODUCTION_STAGE@": production,
  };
  const dockerfile = source.replace(/@[A-Z_]+@/g, token => {
    const value = replacements[token];
    if (value === undefined) throw new Error(`Unknown Dockerfile token ${token}`);
    return value;
  });
  const entrypoint = await readFile(new URL("../templates/dev-entrypoint.sh", import.meta.url), "utf8");
  const files: Record<string, string> = { Dockerfile: dockerfile, "dev-entrypoint.sh": entrypoint.replace("@INSTALL@", shell([...manager.install, ...(config.packageManager === "pnpm" ? ["--force"] : [])])),
    ".ship-template.json": JSON.stringify(templateSettings(config), null, 2) + "\n" };
  const spec = { framework: config.framework, kind: plan.kind, runtime: plan.runtime ?? "project", directory: plan.outputDirectory,
    entrypoint: plan.entrypoint ?? null, runtimeDependencies: plan.runtimeDependencies ?? false, runtimeFiles: config.runtimeFiles };
  files["output.json"] = JSON.stringify(spec, null, 2) + "\n";
  for (const name of ["app-entrypoint.mjs", "prepare-output.mjs", ...(config.framework === "gatsby" ? ["gatsby-adapter.cjs"] : [])]) files[name] = await readFile(new URL(`../templates/${name}`, import.meta.url), "utf8");
  if (Object.values(config.services).includes("mongodb") || config.additionalServices.some(s => s.service === "mongodb")) {
    for (const name of ["Dockerfile", "entrypoint.sh", "bootstrap.sh", "bootstrap.js", "health.js", "app-user.js"]) files[`mongodb/${name}`] = await readFile(new URL(`../templates/mongodb/${name}`, import.meta.url), "utf8");
  }
  if (plan.kind === "static") {
    const fallback = plan.routing === "spa" ? `${config.basePath}${plan.spaFallback ?? "index.html"}` : "=404";
    const baseRedirect = config.basePath === "/" ? "" : `    location = ${config.basePath.slice(0, -1)} { return 308 ${config.basePath}; }\n    location / { return 404; }\n`;
    const headers = config.framework === "gatsby" ? `    add_header X-XSS-Protection "1; mode=block" always;\n    add_header X-Content-Type-Options "nosniff" always;\n    add_header Referrer-Policy "same-origin" always;\n    add_header X-Frame-Options "DENY" always;\n    add_header Cache-Control "public, max-age=0, must-revalidate" always;\n` : "";
    // Next can place RSC payloads in a route directory while its HTML is an
    // adjacent .html file. A trailing slash must not select that empty index.
    const nextRoutes = config.framework === "next" ? `    location ~ ^(?<ship_export_path>/.*)/$ {\n        try_files $ship_export_path/index.html $ship_export_path.html =404;\n    }\n` : "";
    files["nginx.conf"] = `server {\n    listen 8080;\n    server_name _;\n    root /usr/share/nginx/html;\n    index index.html;\n    absolute_redirect off;\n${headers}    error_page 404 ${config.basePath}404.html;\n    location = ${config.basePath}404.html { internal; }\n${baseRedirect}    location ${config.basePath} { try_files $uri $uri.html $uri/ ${fallback}; }\n${nextRoutes}    location ~* \\.(?:js|mjs|css|map|json|png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|wasm)$ {\n        try_files $uri =404;\n    }\n}\n`;
  }
  return Object.fromEntries(Object.entries(files).map(([name, contents]) => [name, contents.replace(/\r\n/g, "\n")]));
}
