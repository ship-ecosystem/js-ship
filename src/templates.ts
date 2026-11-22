import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { resolveWorkspace } from "./workspaces.js";
import { IMAGES, NODE_MINIMUMS } from "./images.js";
import { createConfigSchema } from "./schema.js";
import { adapterFor, builtinAdapters } from "./adapters.js";
import { loadExtensions } from "./extensions.js";
import type { ExtensionRegistry, ShipConfig } from "./contracts.js";
import { exists, readJson } from "./config.js";
import { packageManagers } from "./package-managers.js";

const quote = (arg: string): string => `'${arg.replaceAll("'", "'\\''")}'`;
const shell = (args: readonly string[]): string => args.map(quote).join(" ");
export function templateSettings(config: ShipConfig, workspacePackages: readonly string[] = [], registry?: ExtensionRegistry): Record<string, unknown> {
  const plan = adapterFor(config, registry).packaging(config);
  return { format: 8, packaging: JSON.stringify(plan), buildArguments: JSON.stringify(adapterFor(config, registry).buildArguments?.(config) ?? null), extensions: registry && (registry.extensions.length || config.extensions.length) ? registry.fingerprint : null, images: JSON.stringify(IMAGES), workspace: JSON.stringify(config.workspace), workspacePackages: JSON.stringify(workspacePackages), build: JSON.stringify({ publicEnv: Object.keys(config.build.publicEnv).sort(), secrets: config.build.secrets, npmrc: config.build.npmrc }), packageManager: config.packageManager, ...(config.packageManager === "yarn" ? { yarnNodeModules: 1 } : {}), ...(config.workspace && plan.kind === "node" && ["next", "nuxt"].includes(config.framework) ? { isolatedWorkspace: 1 } : {}), framework: config.framework, deployment: config.deployment,
    kind: plan.kind, outputDirectory: plan.outputDirectory, routing: plan.routing, basePath: config.basePath,
    entrypoint: plan.entrypoint ?? null, runtimeFiles: JSON.stringify(config.runtimeFiles), angularProject: config.angularProject,
    ...(config.framework === "gatsby" ? { gatsbyStaticHeaders: 1 } : {}),
    ...(config.framework === "next" && plan.kind === "static" ? { nextStaticRouting: 1 } : {}) };
}
export async function templateProblems(config: ShipConfig, root: string, registry?: ExtensionRegistry): Promise<string[]> {
  if (!(await exists(resolve(root, "ship/Dockerfile")))) return [];
  const marker = resolve(root, "ship/.ship-template.json");
  if (!(await exists(marker))) return ["Existing Docker templates predate packaging metadata. Review your edits, then run ship init --force to publish current templates."];
  const settings = await readJson(marker);
  const expected = templateSettings(config, await resolveWorkspace(config, root), registry ?? await loadExtensions(root, config.extensions));
  return settings !== null && typeof settings === "object" && Object.entries(expected).every(([key, value]) => (settings as Record<string, unknown>)[key] === value) ? []
    : ["Docker templates were generated for different packaging settings. Review your edits, then run ship init --force."];
}

export async function renderTemplates(config: ShipConfig, workspacePackages: readonly string[] = [], registry?: ExtensionRegistry): Promise<Record<string, string>> {
  const adapter = adapterFor(config, registry);
  const plan = adapter.packaging(config);
  const appPath = config.workspace ? `/app/${config.workspace.app}` : "/app";
  const helper = config.workspace ? "/app/ship/prepare-output.mjs" : "ship/prepare-output.mjs";
  const dependencyBuilds = (config.workspace?.buildDependencies ?? []).map(path => `(cd ${quote(`/app/${path}`)} && ${config.packageManager} run build)`);
  const manager = packageManagers[config.packageManager];
  const distribution = config.packageManager === "yarn" ? "@yarnpkg/cli-dist" : config.packageManager;
  const setup = `ARG SHIP_PACKAGE_MANAGER_VERSION\nRUN if command -v corepack >/dev/null 2>&1; then corepack disable; fi${config.packageManager === "yarn" ? "\nRUN rm -f /usr/local/bin/yarn /usr/local/bin/yarnpkg" : ""}\nRUN test -n "$SHIP_PACKAGE_MANAGER_VERSION" && npm install --global --engine-strict "${distribution}@$SHIP_PACKAGE_MANAGER_VERSION" --no-audit --no-fund\nENV CI=true${config.packageManager === "pnpm" ? "\nENV PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false" : config.packageManager === "yarn" ? "\nENV YARN_NODE_LINKER=node-modules YARN_IGNORE_PATH=true YARN_ENABLE_GLOBAL_CACHE=true YARN_INSTALL_STATE_PATH=/app/node_modules/.yarn-install-state.gz" : ""}`;
  const production = plan.kind === "node"
    ? `FROM base AS production\nENV NODE_ENV=production\nCOPY --from=builder --chown=node:node ${plan.runtime && plan.runtime !== "project" ? "/opt/ship-runtime" : "/app"} /app\nCOPY ship/app-entrypoint.mjs /usr/local/bin/ship-app-entrypoint.mjs\n${config.workspace ? `WORKDIR ${appPath}\n` : ""}USER node\nENTRYPOINT ["node", "/usr/local/bin/ship-app-entrypoint.mjs"]`
    : `FROM ${IMAGES.nginx} AS production\nCOPY ship/nginx.conf /etc/nginx/conf.d/default.conf\nCOPY --from=builder ${appPath}/${plan.outputDirectory}/ /usr/share/nginx/html${config.basePath}\nUSER 101:101\nEXPOSE 8080`;
  const source = await readFile(new URL("../templates/Dockerfile", import.meta.url), "utf8");
  const extra = adapter.buildArguments?.(config) ?? (plan.kind === "static" && builtinAdapters.has(config.framework) ? ["--base", config.basePath] : []);
  const extraText = extra.length ? `${config.packageManager === "npm" ? " --" : ""} ${shell(extra)}` : "";
  const npmrcMount = config.build.npmrc ? "--mount=type=secret,id=ship_npmrc,required=true " : "";
  const npmrcEnv = config.build.npmrc ? "NPM_CONFIG_USERCONFIG=/run/secrets/ship_npmrc " : "";
  const secretMounts = config.build.secrets.map(key => `--mount=type=secret,id=ship_build_${key},env=${key},required=true `).join("");
  const replacements: Record<string, string> = {
    "@PACKAGE_MANAGER_SETUP@": setup, "@NODE_IMAGE@": IMAGES.node24,
    "@DEPENDENCY_COPY@": config.workspace || config.packageManager === "yarn" ? "COPY . ." : `COPY package.json ${manager.lockfile} ./`,
    "@DEVELOPMENT_DEPENDENCY_DIRS@": shell(["/app/node_modules", ...workspacePackages.map(path => `/app/${path}/node_modules`)]),
    "@INSTALL@": `${npmrcMount}${npmrcEnv}${shell(manager.install)}`,
    "@PUBLIC_BUILD_ARGS@": Object.keys(config.build.publicEnv).sort().map(key => `ARG ${key}`).join("\n"),
    "@BUILD_SECRET_MOUNTS@": secretMounts,
    "@BUILD_PREPARE@": `${config.workspace ? `WORKDIR ${appPath}\n` : ""}${["nuxt", "tanstack-start"].includes(config.framework) && plan.kind === "node" ? "ENV NITRO_PRESET=node-server\n" : ""}RUN node ${helper} --clean`,
    "@BUILD@": `${dependencyBuilds.length ? dependencyBuilds.join(" && ") + " && " : ""}if [ -n "$SHIP_BUILD_SCRIPT" ]; then ${config.packageManager} run "$SHIP_BUILD_SCRIPT"${extraText}; fi`,
    "@BUILDER_FINISH@": `${plan.kind === "node" ? `RUN ${npmrcMount}${config.workspace ? "cd /app && " : ""}${npmrcEnv}${shell(manager.prune)}\n` : ""}RUN node ${helper}`,
    "@PRODUCTION_STAGE@": production,
  };
  const dockerfile = source.replace(/@[A-Z_]+@/g, token => {
    const value = replacements[token];
    if (value === undefined) throw new Error(`Unknown Dockerfile token ${token}`);
    return value;
  });
  const entrypoint = await readFile(new URL("../templates/dev-entrypoint.sh", import.meta.url), "utf8");
  const files: Record<string, string> = { Dockerfile: dockerfile, "dev-entrypoint.sh": entrypoint.replace("@INSTALL@", `${npmrcEnv}${shell([...manager.install, ...(config.packageManager === "pnpm" ? ["--force"] : [])])}`).replace("@WORKSPACE_BUILD@", dependencyBuilds.join("\n")).replace("@APP_DIRECTORY@", quote(appPath)),
    ".ship-template.json": JSON.stringify(templateSettings(config, workspacePackages, registry), null, 2) + "\n" };
  files["runtime-version.mjs"] = await readFile(new URL("./runtime-version.js", import.meta.url), "utf8");
  files["check-runtime.mjs"] = `import { nodeRuntimeProblem } from './runtime-version.mjs';\nconst problem = nodeRuntimeProblem(process.versions.node, ${JSON.stringify(NODE_MINIMUMS)});\nif (problem) { console.error(problem); process.exitCode = 1; }\n`;
  files["ship.schema.json"] = JSON.stringify(createConfigSchema(registry), null, 2) + "\n";
  const spec = { framework: config.framework, kind: plan.kind, runtime: plan.runtime ?? "project", directory: plan.outputDirectory,
    entrypoint: plan.entrypoint ?? null, runtimeDependencies: plan.runtimeDependencies ?? false, runtimeFiles: config.runtimeFiles, workspaceApp: config.workspace?.app ?? null };
  files["output.json"] = JSON.stringify(spec, null, 2) + "\n";
  for (const name of ["app-entrypoint.mjs", "prepare-output.mjs", ...(config.framework === "gatsby" ? ["gatsby-adapter.cjs"] : [])]) files[name] = await readFile(new URL(`../templates/${name}`, import.meta.url), "utf8");
  if (Object.values(config.services).includes("mongodb") || config.additionalServices.some(s => s.service === "mongodb")) {
    for (const name of ["Dockerfile", "entrypoint.sh", "bootstrap.sh", "bootstrap.js", "health.js", "app-user.js"]) files[`mongodb/${name}`] = (await readFile(new URL(`../templates/mongodb/${name}`, import.meta.url), "utf8")).replace("@MONGODB_IMAGE@", IMAGES.mongo);
  }
  if (Object.values(config.services).includes("garage") || config.additionalServices.some(s => s.service === "garage")) {
    for (const name of ["Dockerfile", "garage.toml"]) files[`garage/${name}`] = await readFile(new URL(`../templates/garage/${name}`, import.meta.url), "utf8");
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
  Object.assign(files, registry?.templates ?? {});
  return Object.fromEntries(Object.entries(files).map(([name, contents]) => [name, contents.replace(/\r\n/g, "\n")]));
}
