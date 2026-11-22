import type { ProcessConfig, ProjectManifest, ShipConfig } from "./contracts.js";
import { scriptCommand } from "./package-managers.js";
export interface ProcessSuggestion { label: string; definition: ProcessConfig }
export interface ReleaseDescription { health?: string | null; urlSetting?: string | null; requiredEnv?: readonly string[]; console?: Readonly<Record<string, readonly string[]>> }
export function scriptProcessSuggestions(config: ShipConfig, manifest: ProjectManifest): Record<string, ProcessSuggestion> {
  if (config.deployment === "static") return {};
  return Object.fromEntries(Object.keys(manifest.scripts ?? {}).filter(name => /^(?:worker|queue(?::work)?|schedule(?:r)?|realtime|socket(?:s)?|ws)(?::[a-z0-9_-]+)?$/.test(name))
    .map(script => [script.replaceAll(":", "-"), { label: `package script ${script}`, definition: scriptCommand(config, script) }]));
}
