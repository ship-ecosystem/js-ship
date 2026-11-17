import { resolve } from "node:path";
import { readJson, safeRelativePath } from "./config.js";
import { ConfigError } from "./errors.js";

type ObjectMap = Record<string, unknown>;
const object = (value: unknown): ObjectMap => value && typeof value === "object" && !Array.isArray(value) ? value as ObjectMap : {};
export async function angularSettings(root: string, requested: unknown, deployment: "node" | "static"): Promise<{ angularProject: string; outputDirectory: string; serverEntry: string | null }> {
  const workspace = object(await readJson(resolve(root, "angular.json")));
  const applications = Object.entries(object(workspace.projects)).filter(([, value]) => object(value).projectType === "application");
  const selected = typeof requested === "string" ? applications.find(([key]) => key === requested) : applications.length === 1 ? applications[0] : undefined;
  if (!selected) throw new ConfigError(["Select an Angular application with angularProject or --angular-project. Multiple applications are not selected implicitly."]);
  const targets = object(object(selected[1]).architect ?? object(selected[1]).targets);
  const build = object(targets.build);
  if (typeof build.builder !== "string" || !build.builder.endsWith(":application")) throw new ConfigError(["Angular currently requires the modern application builder (@angular/build:application or @angular-devkit/build-angular:application)."]);
  const production = object(object(build.configurations).production);
  if (!Object.hasOwn(object(build.configurations), "production")) throw new ConfigError(["Angular requires a production build configuration."]);
  const options = { ...object(build.options), ...production };
  if (deployment === "node" && !options.ssr) throw new ConfigError(["Configure Angular SSR before selecting deployment: node."]);
  const path = typeof options.outputPath === "string" ? { base: options.outputPath } : object(options.outputPath);
  const base = path.base ?? `dist/${selected[0]}`;
  const browser = path.browser ?? "browser", server = path.server ?? "server";
  if (!safeRelativePath(base) || (browser !== "" && !safeRelativePath(browser)) || !safeRelativePath(server)) throw new ConfigError(["Angular outputPath must use safe relative directories."]);
  return { angularProject: selected[0], outputDirectory: deployment === "static" ? `${base}${browser ? "/" + browser : ""}` : base,
    serverEntry: deployment === "node" ? `${base}/${server}/server.mjs` : null };
}
