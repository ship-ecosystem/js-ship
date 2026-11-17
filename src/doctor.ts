import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { readConfig, exists } from "./config.js";
import { loadExtensions } from "./extensions.js";
import { projectProblems } from "./init.js";
import { generatedFileProblems } from "./project.js";
import { templateProblems } from "./templates.js";
import { buildProjectCompose } from "./compose.js";
import { buildContextProblems, buildSecretProblems } from "./build-environment.js";
import type { ShipConfig } from "./contracts.js";
import type { Runner } from "./process.js";
import { ConfigError, ProcessError } from "./errors.js";

export interface DoctorCheck { name: string; status: "ok" | "warning" | "error"; message: string; hint?: string }
export interface DoctorReport { ok: boolean; checks: DoctorCheck[] }
const clean = (value: string): string => value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").slice(0, 1000);
function propagateCancellation(error: unknown): void {
  if (error instanceof ProcessError && [130, 143].includes(error.exitCode)) throw new ProcessError("Diagnostics cancelled.", error.exitCode);
}
const INSPECT = '{"service":{{json (index .Config.Labels "com.docker.compose.service")}},"oneoff":{{json (index .Config.Labels "com.docker.compose.oneoff")}},"state":{{json .State.Status}},"exitCode":{{json .State.ExitCode}},"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}null{{end}},"restarts":{{json .RestartCount}}}';

/** Diagnostics inspect metadata only: never fetch container environments, logs or health output. */
export async function diagnoseProject(root: string, runner: Runner): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const add = (name: string, status: DoctorCheck["status"], message: string, hint?: string) => {
    checks.push({ name: clean(name), status, message: clean(message), ...(hint ? { hint: clean(hint) } : {}) });
  };
  const directory = await stat(root).then(value => value.isDirectory()).catch(() => false);
  const probeRoot = directory ? root : process.cwd();
  let config: ShipConfig | undefined;
  let expected: Set<string> | undefined;
  let mongoNames = new Set<string>();
  if (!directory) add("project", "error", "Project directory is unavailable or is not a directory.", "Use --project-directory PATH to select an accessible application or workspace root.");
  else {
    try {
      if (!await exists(resolve(root, "package.json"))) add("project", "error", "package.json is missing.", "Use --project-directory PATH to select the application or workspace root containing package.json.");
      config = await readConfig(root);
    } catch { add("project", "error", "Cannot read a valid ship.json or project files.", "Run ship init, or correct JSON syntax/file permissions and run ship config:test."); }
  }
  if (config) {
    try {
      const registry = await loadExtensions(root, config.extensions);
      const problems = [
        ...await projectProblems(config, root, registry), ...await templateProblems(config, root, registry),
        ...await buildContextProblems(root), ...await buildSecretProblems(config, root, true), ...await generatedFileProblems(config, root, registry),
      ];
      for (const problem of new Set(problems)) add("project", "error", problem, "Correct project files and rerun ship init or ship config:test. --force replaces edited templates; use it deliberately.");
      const model = await buildProjectCompose(config, root, "development", "local", registry);
      expected = new Set(Object.keys(model.services));
      mongoNames = new Set(Object.entries(model.services).filter(([, service]) => typeof service.environment === "object" && service.environment !== null && "SHIP_MONGO_MODE" in service.environment).map(([name]) => name));
      if (!problems.length) add("project", "ok", "Ship development settings and generated template files passed validation.");
    } catch (error) {
      propagateCancellation(error);
      const messages = error instanceof ConfigError ? error.problems.map(message => message.startsWith("Cannot read ") ? "A project file could not be read; check JSON syntax and file permissions." : message) : ["Project or extension validation could not complete."];
      for (const message of messages) add("project", "error", message, "Check package.json, ship.json and extensions; run ship config:test for validation.");
    }
  }
  let docker = false, daemon = false, compose = false;
  try { const version = await runner(["docker", "--version"], probeRoot, { capture: true }); add("docker-cli", "ok", version.trim()); docker = true; }
  catch (error) { propagateCancellation(error); add("docker-cli", "error", "Docker CLI is unavailable.", "Install Docker Engine or Docker Desktop and ensure docker is on PATH."); }
  if (docker) {
    try {
      const version = (await runner(["docker", "compose", "version", "--short"], probeRoot, { capture: true })).trim();
      const match = /^v?(\d+)\.(\d+)\.\d+(?:[-+].*)?$/.exec(version);
      if (!match || Number(match[1]) < 2 || (Number(match[1]) === 2 && Number(match[2]) < 24)) {
        add("compose", "error", "Compose 2.24.0 or newer is required for Ship's generated env_file settings.", "Upgrade the Docker Compose plugin, then check docker compose version.");
      } else { add("compose", "ok", `Compose ${version}`); compose = true; }
    }
    catch (error) { propagateCancellation(error); add("compose", "error", "Docker Compose plugin is unavailable.", "Install or enable the Docker Compose v2+ plugin; check docker compose version."); }
    try { const version = await runner(["docker", "version", "--format", "{{.Server.Version}}"], probeRoot, { capture: true }); add("docker-daemon", "ok", `Docker Engine ${version.trim()}`); daemon = true; }
    catch (error) { propagateCancellation(error); add("docker-daemon", "error", "Cannot reach the Docker daemon with the current permissions/context.", "Start Docker Engine/Desktop, check docker context show and verify permission to access the daemon."); }
  }
  if (config && daemon && compose) {
    try {
      const ids = (await runner(["docker", "ps", "--all", "--filter", `label=com.docker.compose.project=${config.name}`, "--format", "{{.ID}}"], probeRoot, { capture: true })).trim().split(/\s+/).filter(Boolean);
      if (ids.some(id => !/^[a-f0-9]{12,64}$/.test(id))) throw new Error("Invalid container IDs");
      const rows: unknown[] = ids.length ? (await runner(["docker", "inspect", "--format", INSPECT, ...ids], probeRoot, { capture: true })).trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as unknown) : [];
      const seen = new Set<string>();
      for (const row of rows) {
        if (!row || typeof row !== "object" || !("service" in row) || typeof row.service !== "string" || !("state" in row) || typeof row.state !== "string") throw new Error("Invalid container metadata");
        if ("oneoff" in row && String(row.oneoff).toLowerCase() === "true") continue;
        const service = clean(row.service);
        const logs = `Run ship logs ${service} and review docs/recovery.md.`;
        seen.add(row.service);
        if (expected && !expected.has(row.service)) {
          add(service, "warning", "Container belongs to this project but is absent from the current configuration.", "Review renamed/removed services and stop the old stack before applying a service rename."); continue;
        }
        const health = "health" in row && typeof row.health === "string" ? row.health : "";
        const exit = "exitCode" in row && typeof row.exitCode === "number" ? row.exitCode : 0;
        const restarts = "restarts" in row && typeof row.restarts === "number" ? row.restarts : 0;
        if (health === "unhealthy") add(service, "error", `${row.state}; healthcheck is unhealthy.`, mongoNames.has(row.service)
          ? `${logs} Verify persisted MongoDB users match configured credentials and the replica set has a writable primary. Preserve data/config volumes; environment edits do not rotate stored users.` : logs);
        else if (["dead", "restarting"].includes(row.state) || (row.state === "exited" && exit !== 0)) add(service, "error", `${row.state}; exit code ${exit}, restart count ${restarts}.`, logs);
        else if (row.state === "paused") add(service, "warning", "Container is paused.", "Unpause the container with Docker, then rerun ship doctor.");
        else if (row.state !== "running") add(service, "warning", `${row.state}; service is not running.`, "Run ship up when you want to start the development stack; existing named volumes are retained.");
        else if (health === "starting") add(service, "warning", "Running; healthcheck is still starting.", "Wait for initialization, rerun ship doctor and inspect logs if it remains pending.");
        else add(service, "ok", `Running; ${health === "healthy" ? "healthy" : "no healthcheck"}; restart count ${restarts}.`);
      }
      if (!seen.size) add("stack", "warning", "No development service containers found for this project.", "Run ship up to start the development stack.");
      else for (const name of expected ?? []) if (!seen.has(name)) add(name, "warning", "Expected development service container is missing.", "Run ship up after correcting project configuration.");
    } catch (error) { propagateCancellation(error); add("stack", "error", "Could not read project container status.", "Check Docker daemon access and rerun ship doctor. No container logs or environment values are included in this report."); }
  }
  return { ok: !checks.some(check => check.status === "error"), checks };
}

export function formatDoctor(report: DoctorReport): string {
  return report.checks.map(check => `${check.status.toUpperCase()} ${check.name}: ${check.message}${check.hint ? `\n  ${check.hint}` : ""}`).join("\n");
}
