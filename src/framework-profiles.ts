import type { FrameworkAdapter, ProjectManifest, ShipConfig, PackagingPlan } from "./contracts.js";
import { scriptCommand } from "./package-managers.js";

const has = (m: ProjectManifest, key: string) => Object.hasOwn({ ...m.devDependencies, ...m.dependencies }, key);
const scriptText = (manifest: ProjectManifest, name: string | null) => name && Object.hasOwn(manifest.scripts ?? {}, name) ? manifest.scripts?.[name] ?? "" : "";
const PROFILES = {
  next: { dependency: "next", port: 3000, nodeDir: ".next/standalone", entry: "server.js", staticDir: "out", runtime: "next" },
  nuxt: { dependency: "nuxt", port: 3000, nodeDir: ".output", entry: "server/index.mjs", staticDir: ".output/public", runtime: "bundle" },
  sveltekit: { dependency: "@sveltejs/kit", port: 5173, nodeDir: "build", entry: "index.js", staticDir: "build", runtime: "bundle" },
  astro: { dependency: "astro", port: 4321, nodeDir: "dist", entry: "server/entry.mjs", staticDir: "dist", runtime: "bundle" },
  angular: { dependency: "@angular/core", port: 4200, nodeDir: "dist/app", entry: "server/server.mjs", staticDir: "dist/app/browser", runtime: "bundle" },
  "tanstack-start": { dependency: "@tanstack/react-start", port: 3000, nodeDir: ".output", entry: "server/index.mjs", staticDir: "", runtime: "bundle" },
  gatsby: { dependency: "gatsby", port: 8000, nodeDir: "", entry: "", staticDir: "public", runtime: "bundle" },
} as const;

export const defaultDeployment = (framework: string): "node" | "static" => ["react", "vue", "svelte", "vitepress", "astro", "angular", "gatsby"].includes(framework) ? "static" : "node";

function profileAdapter(key: keyof typeof PROFILES): FrameworkAdapter {
  const profile = PROFILES[key];
  const plan = (config: ShipConfig): PackagingPlan => {
    const directory = config.outputDirectory ?? (config.deployment === "static" ? profile.staticDir : profile.nodeDir);
    if (config.deployment === "static") return { kind: "static", port: 8080, outputDirectory: directory, routing: config.staticRouting,
      ...(key === "angular" ? { spaFallback: "index.csr.html" } : {}) };
    const entrypoint = config.serverEntry ?? (key === "next" ? "server.js" : `${directory}/${profile.entry}`);
    return { kind: "node", port: config.port, outputDirectory: directory, routing: "html", runtime: profile.runtime, entrypoint,
      runtimeDependencies: ["sveltekit", "astro", "angular"].includes(key) };
  };
  return {
    key, label: key,
    defaults(manifest, deployment = defaultDeployment(key)) {
      return { scripts: { dev: key === "angular" && !manifest.scripts?.dev ? "start" : "dev",
        build: key === "nuxt" && deployment === "static" ? "generate" : "build", start: null },
      port: profile.port, outputDirectory: deployment === "static" ? profile.staticDir || null : profile.nodeDir || null,
      staticRouting: key === "angular" ? "spa" : "html" };
    },
    validate(config, manifest) {
      const errors: string[] = [];
      if (!has(manifest, profile.dependency) && !(key === "tanstack-start" && has(manifest, "@tanstack/solid-start"))) errors.push(`${key} requires ${profile.dependency} in package.json.`);
      for (const stage of ["dev", "build"] as const) {
        const script = config.scripts[stage];
        if (!script || !Object.hasOwn(manifest.scripts ?? {}, script) || !manifest.scripts?.[script]) errors.push(`${key} requires a configured ${stage} script in package.json.`);
      }
      if (key === "gatsby" && config.deployment !== "static") errors.push("Gatsby currently supports static output only; SSR, DSG and functions are rejected by the generated Gatsby adapter.");
      if (key === "gatsby" && manifest.type === "module") errors.push("Gatsby currently requires a CommonJS root package (omit type or use type: commonjs); use gatsby-config.mjs for ESM configuration. Its CLI subprocess fails under type: module.");
      if (key === "tanstack-start" && config.deployment !== "node") errors.push("TanStack Start currently supports Node output through the Nitro Vite plugin only.");
      if (key === "tanstack-start" && !has(manifest, "nitro") && !has(manifest, "nitropack")) errors.push("TanStack Start Node packaging requires Nitro configured with its Vite plugin and node-server preset.");
      if (["sveltekit", "tanstack-start"].includes(key) && !has(manifest, "vite")) errors.push(`${key} requires Vite tooling in package.json.`);
      if (key === "sveltekit" && !has(manifest, config.deployment === "node" ? "@sveltejs/adapter-node" : "@sveltejs/adapter-static")) errors.push(`Install and configure @sveltejs/adapter-${config.deployment === "node" ? "node" : "static"} in your SvelteKit configuration (vite.config.js for SvelteKit 3).`);
      if (key === "astro" && config.deployment === "node" && !has(manifest, "@astrojs/node")) errors.push("Astro Node deployment requires @astrojs/node in standalone mode.");
      if (key === "next" && config.deployment === "node" && config.serverEntry !== null) errors.push("Next.js uses the standalone server.js entry; custom entrypoints are not supported. Workspace standalone output must mirror the repository root.");
      if (key === "next" && config.outputDirectory !== null && config.outputDirectory !== (config.deployment === "node" ? ".next/standalone" : "out")) errors.push("Next.js currently requires standard .next/standalone or out output paths.");
      if (config.basePath !== "/" && !(config.deployment === "static" && ["angular", "astro"].includes(key))) errors.push(`${key} currently requires basePath: /. Configure framework subpaths only after adapter support is added.`);
      if (config.deployment === "static" && (Object.keys(config.processes).length || config.deployCommands.length || config.runtimeFiles.length)) errors.push("Static output cannot include Node workers, deploy commands or runtimeFiles.");
      const current = plan(config);
      if (current.runtime === "bundle" && current.entrypoint && !current.entrypoint.startsWith(`${current.outputDirectory}/`)) errors.push("serverEntry must be inside outputDirectory.");
      const dev = scriptText(manifest, config.scripts.dev);
      const build = scriptText(manifest, config.scripts.build);
      if (key === "angular" && (dev.trim() !== "ng serve" || build.trim() !== "ng build")) errors.push("Angular scripts must be ng serve and ng build; angularProject selects the application and Ship selects production configuration.");
      if (key === "nuxt" && config.deployment === "static" && !/^nuxt\s+generate(?:\s|$)/.test(build.trim())) errors.push("Nuxt static deployment requires a nuxt generate script.");
      if (key === "gatsby" && (dev.trim() !== "gatsby develop" || build.trim() !== "gatsby build")) errors.push("Gatsby scripts must be gatsby develop and gatsby build; configure ship/gatsby-adapter.cjs in gatsby-config.");
      return errors;
    },
    packaging: plan,
    developmentCommand(config) {
      const flags = key === "next" ? ["--hostname", "0.0.0.0", "--port", String(config.port)]
        : key === "angular" ? [config.angularProject ?? "", "--host", "0.0.0.0", "--port", String(config.port)]
        : ["--host", "0.0.0.0", "--port", String(config.port), ...(["sveltekit", "tanstack-start"].includes(key) ? ["--strictPort"] : [])];
      if (key === "astro" && config.deployment === "static") flags.push("--base", config.basePath);
      return scriptCommand(config, config.scripts.dev, flags);
    },
    productionCommand: config => config.deployment === "static" ? ["nginx", "-g", "daemon off;"] : ["node", plan(config).entrypoint!],
    buildArguments(config) {
      if (key === "angular") return [config.angularProject ?? "", "--configuration", "production", "--output-mode", config.deployment === "node" ? "server" : "static", ...(config.deployment === "static" ? ["--base-href", config.basePath] : [])];
      if (key === "astro" && config.deployment === "static") return ["--base", config.basePath];
      return [];
    },
  };
}

export const frameworkProfiles = (Object.keys(PROFILES) as (keyof typeof PROFILES)[]).map(profileAdapter);
