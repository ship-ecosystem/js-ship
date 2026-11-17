import type { FrameworkAdapter, ProjectManifest, ShipConfig } from "./contracts.js";
import { ConfigError } from "./errors.js";
import { scriptCommand } from "./package-managers.js";
import { frameworkProfiles } from "./framework-profiles.js";

const dependencies = (manifest: ProjectManifest) => ({ ...manifest.devDependencies, ...manifest.dependencies });
const has = (manifest: ProjectManifest, key: string) => Object.hasOwn(dependencies(manifest), key);
const scriptText = (manifest: ProjectManifest, name: string | null) => name && Object.hasOwn(manifest.scripts ?? {}, name) ? manifest.scripts?.[name] ?? "" : "";
const scriptsPresent = (config: ShipConfig, manifest: ProjectManifest, stages: readonly (keyof ShipConfig["scripts"])[]): string[] =>
  stages.flatMap(stage => {
    const script = config.scripts[stage];
    return script === null ? [`${stage} script is required by the ${config.framework} adapter.`]
      : !Object.hasOwn(manifest.scripts ?? {}, script) || !manifest.scripts?.[script] ? [`${stage} script ${JSON.stringify(script)} is missing from package.json.`] : [];
  });

function nodeAdapter(key: string, label: string, dependency?: string): FrameworkAdapter {
  return {
    key, label,
    defaults: manifest => ({ scripts: { dev: key === "nestjs" ? "start:dev" : "dev", build: manifest.scripts?.build ? "build" : null,
      start: key === "nestjs" ? "start:prod" : "start" }, port: 3000, outputDirectory: null, staticRouting: "spa" }),
    validate(config, manifest) {
      return [...scriptsPresent(config, manifest, ["dev", "start", ...(config.scripts.build !== null || key === "nestjs" ? ["build" as const] : [])]),
        ...(config.deployment !== "node" ? [`${label} requires deployment: node.`] : []),
        ...(config.serverEntry !== null ? ["This adapter runs the production start script; serverEntry is for framework-output adapters."] : []),
        ...(dependency && !has(manifest, dependency) ? [`${label} requires ${dependency} in package.json.`] : []),
        ...(config.outputDirectory !== null ? ["outputDirectory is only supported for static packaging; Node adapters use their production start script."] : []),
        ...(config.basePath !== "/" ? ["basePath is currently supported only by static adapters."] : [])];
    },
    packaging: config => ({ kind: "node", port: config.port, outputDirectory: null, routing: "spa" }),
    developmentCommand: config => scriptCommand(config, config.scripts.dev),
    productionCommand: config => scriptCommand(config, config.scripts.start),
  };
}

/** Limit automatic script interpretation to direct CLI calls, never shell/config execution. */
function vitepressRoot(command: string): string | null {
  const match = /^vitepress\s+(?:dev|build)(?:\s+(.*))?$/.exec(command.trim());
  if (!match || /[&|;<>`$]/.test(match[1] ?? "")) return null;
  const first = match[1]?.split(/\s+/)[0];
  if (!first || first.startsWith("--")) return "";
  if (!/^[A-Za-z0-9_.\/-]+$/.test(first) || first.startsWith("/")) return null;
  const root = first.replace(/^\.\//, "").replace(/\/$/, "");
  return root === "." ? "" : root;
}

function staticAdapter(key: string, label: string, dependency: string): FrameworkAdapter {
  const docs = key === "vitepress";
  return {
    key, label,
    defaults(manifest) {
      const pick = (preferred: string[], fallback: string) => preferred.find(name => manifest.scripts?.[name]) ?? fallback;
      const dev = docs ? pick(["docs:dev", "dev"], "docs:dev") : "dev";
      const build = docs ? pick(["docs:build", "build"], "docs:build") : "build";
      const root = docs ? vitepressRoot(manifest.scripts?.[build] ?? "") : null;
      return { scripts: { dev, build, start: null }, port: 5173,
        outputDirectory: docs ? `${root ? root + "/" : ""}.vitepress/dist` : "dist", staticRouting: docs ? "html" : "spa" };
    },
    validate(config, manifest) {
      const problems = scriptsPresent(config, manifest, ["dev", "build"]);
      if (config.deployment !== "static") problems.push(`${label} requires deployment: static.`);
      if (!has(manifest, dependency)) problems.push(`${label} requires ${dependency} in package.json.`);
      if (!docs && !has(manifest, "vite")) problems.push(`${label} currently supports Vite projects. Add/select Vite tooling or use another adapter.`);
      const dev = scriptText(manifest, config.scripts.dev);
      const build = scriptText(manifest, config.scripts.build);
      if (docs) {
        if (config.staticRouting !== "html") problems.push("VitePress requires staticRouting: html for generated pages and proper 404 responses.");
        if (vitepressRoot(dev) === null || !/^vitepress\s+dev(?:\s|$)/.test(dev.trim())) problems.push("VitePress development script must directly run vitepress dev with a literal root directory.");
        if (vitepressRoot(build) === null || !/^vitepress\s+build(?:\s|$)/.test(build.trim())) problems.push("VitePress build script must directly run vitepress build; set outputDirectory when overriding its outDir.");
        if (vitepressRoot(dev) !== null && vitepressRoot(build) !== null && vitepressRoot(dev) !== vitepressRoot(build)) problems.push("VitePress development and build scripts must use the same root directory.");
      } else {
        if (!/^vite(?:\s|$)/.test(dev.trim()) || /^vite\s+(?:build|preview)(?:\s|$)/.test(dev.trim())) problems.push("Development script must directly run the Vite dev server.");
        if (!/(?:^|&&\s*)vite\s+build(?:\s+[^&|;<>]*)?$/.test(build.trim()) || /(?:^|\s)--ssr(?:\s|=|$)/.test(build)) problems.push("Build script must end with a static Vite build; SSR requires a framework server adapter.");
      }
      if (Object.keys(config.processes).length || config.deployCommands.length || config.runtimeFiles.length) problems.push("Static images have no Node runtime. Put workers, runtimeFiles and deploy commands in a backend Ship project.");
      return problems;
    },
    packaging: config => ({ kind: "static", port: 8080, outputDirectory: config.outputDirectory ?? (docs ? ".vitepress/dist" : "dist"), routing: docs ? "html" : config.staticRouting }),
    developmentCommand: config => scriptCommand(config, config.scripts.dev, ["--host", "0.0.0.0", "--port", String(config.port), "--strictPort", "--base", config.basePath]),
    productionCommand: () => ["nginx", "-g", "daemon off;"],
  };
}

export const genericAdapter = nodeAdapter("generic", "Generic Node.js application");
export const builtinAdapters = new Map([
  genericAdapter, nodeAdapter("expressjs", "Express.js", "express"), nodeAdapter("fastify", "Fastify", "fastify"), nodeAdapter("nestjs", "NestJS", "@nestjs/core"),
  staticAdapter("react", "React (Vite)", "react"), staticAdapter("vue", "Vue (Vite)", "vue"), staticAdapter("svelte", "Svelte (Vite)", "svelte"), staticAdapter("vitepress", "VitePress", "vitepress"),
  ...frameworkProfiles,
].map(adapter => [adapter.key, adapter]));

/** Specific full-stack frameworks win even before their deployment adapter is available. */
export function detectFramework(manifest: ProjectManifest): string {
  const priority = [
    ["next", "next"], ["nuxt", "nuxt"], ["sveltekit", "@sveltejs/kit"], ["astro", "astro"],
    ["tanstack-start", "@tanstack/react-start"], ["tanstack-start", "@tanstack/solid-start"], ["gatsby", "gatsby"],
    ["vitepress", "vitepress"], ["angular", "@angular/core"], ["nestjs", "@nestjs/core"],
    ["react", "react"], ["vue", "vue"], ["svelte", "svelte"], ["fastify", "fastify"], ["expressjs", "express"],
  ];
  return priority.find(([, dependency]) => has(manifest, dependency!))?.[0] ?? "generic";
}

export function adapterFor(config: Pick<ShipConfig, "framework">): FrameworkAdapter {
  const adapter = builtinAdapters.get(config.framework);
  if (!adapter) throw new ConfigError([`Adapter ${JSON.stringify(config.framework)} is not implemented yet. Available: ${[...builtinAdapters.keys()].join(", ")}. Select generic explicitly only when its Node packaging fits your app.`]);
  return adapter;
}
