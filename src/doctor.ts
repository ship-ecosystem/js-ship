import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { readConfig, exists } from "./config.js";
import { loadExtensions } from "./extensions.js";
import { projectProblems } from "./init.js";
import { composeFileArguments, developmentOverrideFiles, generatedFileProblems } from "./project.js";
import { templateProblems } from "./templates.js";
import { buildProjectCompose, render } from "./compose.js";
import { buildContextProblems, buildSecretProblems } from "./build-environment.js";
import type { ComposeModel, ShipConfig } from "./contracts.js";
import type { Runner } from "./process.js";
import { ConfigError, ProcessError } from "./errors.js";

export interface DoctorCheck { name: string; status: "ok" | "warning" | "error"; message: string; hint?: string }
export interface DoctorReport { ok: boolean; checks: DoctorCheck[] }
const clean = (value: string): string => value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").slice(0, 1000);
function propagateCancellation(error: unknown): void {
  if (error instanceof ProcessError && [130, 143].includes(error.exitCode)) throw new ProcessError("Diagnostics cancelled.", error.exitCode);
}
const INSPECT = '{"service":{{json (index .Config.Labels "com.docker.compose.service")}},"oneoff":{{json (index .Config.Labels "com.docker.compose.oneoff")}},"state":{{json .State.Status}},"exitCode":{{json .State.ExitCode}},"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}null{{end}},"restarts":{{json .RestartCount}}}';

/** Container probes request status metadata only; resolved Compose configuration stays private in memory. */
export async function diagnoseProject(root: string, runner: Runner, environment: NodeJS.ProcessEnv = process.env): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const execute: Runner = (args, cwd, options) => runner(args, cwd, { ...options, env: environment });
  const add = (name: string, status: DoctorCheck["status"], message: string, hint?: string) => {
    checks.push({ name: clean(name), status, message: clean(message), ...(hint ? { hint: clean(hint) } : {}) });
  };
  const directory = await stat(root).then(value => value.isDirectory()).catch(() => false);
  const probeRoot = directory ? root : process.cwd();
  let config: ShipConfig | undefined;
  let model: ComposeModel | undefined;
  let projectName: string | undefined;
  let known: Set<string> | undefined;
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
      model = await buildProjectCompose(config, root, "development", "local", registry);
      if (!problems.length) add("project", "ok", "Ship development settings and generated template files passed validation.");
    } catch (error) {
      propagateCancellation(error);
      const messages = error instanceof ConfigError ? error.problems.map(message => message.startsWith("Cannot read ") ? "A project file could not be read; check JSON syntax and file permissions." : message) : ["Project or extension validation could not complete."];
      for (const message of messages) add("project", "error", message, "Check package.json, ship.json and extensions; run ship config:test for validation.");
    }
  }
  let docker = false, daemon = false, compose = false;
  try { const version = await execute(["docker", "--version"], probeRoot, { capture: true }); add("docker-cli", "ok", version.trim()); docker = true; }
  catch (error) { propagateCancellation(error); add("docker-cli", "error", "Docker CLI is unavailable.", "Install Docker Engine or Docker Desktop and ensure docker is on PATH."); }
  if (docker) {
    try {
      let endpoint: unknown;
      if (!environment.DOCKER_CONTEXT && environment.DOCKER_HOST) endpoint = environment.DOCKER_HOST;
      else {
        const context = environment.DOCKER_CONTEXT || (await execute(["docker", "context", "show"], probeRoot, { capture: true })).trim();
        if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*(?![\s\S])/.test(context)) throw new Error("Invalid context");
        endpoint = JSON.parse(await execute(["docker", "context", "inspect", context, "--format", "{{json .Endpoints.docker.Host}}"], probeRoot, { capture: true }));
      }
      if (typeof endpoint !== "string" || !endpoint) throw new Error("Invalid endpoint");
      if (/^(?:unix|npipe):\/\//i.test(endpoint)) add("docker-endpoint", "ok", "Active Docker endpoint uses a socket transport. Daemon locality, filesystem and published-port reachability are not verified.");
      else if (["tcp:", "http:", "https:", "ssh:"].includes(new URL(endpoint).protocol)) add("docker-endpoint", "warning", "Active Docker endpoint uses a network connection; the daemon may run on another host.", "Development bind sources must exist on the daemon host. Published loopback ports and ship up HTTP checks may refer to different machines, including with tunnels. Prefer copying a portable release to the destination; doctor does not verify remote paths or port forwarding.");
      else throw new Error("Unknown endpoint");
    } catch (error) { propagateCancellation(error); add("docker-endpoint", "warning", "Could not classify the active Docker endpoint.", "Review docker context show, DOCKER_CONTEXT and DOCKER_HOST locally. Bind paths belong to the daemon host; a socket or loopback connection can also be forwarded. Endpoint addresses and context values are omitted from this report."); }

    try {
      const version = (await execute(["docker", "compose", "version", "--short"], probeRoot, { capture: true })).trim();
      const match = /^v?(\d+)\.(\d+)\.\d+(?:[-+].*)?$/.exec(version);
      if (!match || Number(match[1]) < 2 || (Number(match[1]) === 2 && Number(match[2]) < 24)) {
        add("compose", "error", "Compose 2.24.0 or newer is required for Ship's generated env_file settings.", "Upgrade the Docker Compose plugin, then check docker compose version.");
      } else { add("compose", "ok", `Compose ${version}`); compose = true; }
    }
    catch (error) { propagateCancellation(error); add("compose", "error", "Docker Compose plugin is unavailable.", "Install or enable the Docker Compose v2+ plugin; check docker compose version."); }
    try { const version = await execute(["docker", "version", "--format", "{{.Server.Version}}"], probeRoot, { capture: true }); add("docker-daemon", "ok", `Docker Engine ${version.trim()}`); daemon = true; }
    catch (error) { propagateCancellation(error); add("docker-daemon", "error", "Cannot reach the Docker daemon with the current permissions/context.", "Start Docker Engine/Desktop, check docker context show and verify permission to access the daemon."); }
  }
  if (config && model && compose) {
    try {
      const overrides = await developmentOverrideFiles(root);
      if (overrides.length > 1) add("compose-overrides", "warning", "Both development override filenames exist; only docker-compose.override.yml is selected.", "Merge intended changes into the selected file or remove it to select compose.override.yaml. Ship development commands use the same precedence; releases ignore these overrides.");
      // Compose resolves its own merge/interpolation semantics. Keep its model in
      // memory and retain only project/service metadata; never print raw output.
      const effective: unknown = JSON.parse(await execute(["docker", "compose", ...await composeFileArguments(root, "development", "-"), "config", "--format", "json"], probeRoot, { capture: true, input: render(model) }));
      if (!effective || typeof effective !== "object" || !("name" in effective) || typeof effective.name !== "string" || !/^[a-z0-9][a-z0-9_-]*(?![\s\S])/.test(effective.name) || !("services" in effective) || !effective.services || typeof effective.services !== "object" || Array.isArray(effective.services)) throw new Error("Invalid effective model");
      const entries = Object.entries(effective.services);
      if (entries.some(([name, service]) => !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*(?![\s\S])/.test(name) || !service || typeof service !== "object" || Array.isArray(service))) throw new Error("Invalid service metadata");
      projectName = effective.name;
      known = new Set(entries.map(([name]) => name));
      expected = new Set(entries.filter(([, service]) => !("profiles" in service) || !Array.isArray(service.profiles) || !service.profiles.length).map(([name]) => name));
      mongoNames = new Set(entries.filter(([, service]) => "environment" in service && service.environment && typeof service.environment === "object" && "SHIP_MONGO_MODE" in service.environment).map(([name]) => name));
      add("development-compose", "ok", overrides.length ? "Effective development Compose configuration, including the selected override, passed validation." : "Effective development Compose configuration passed validation.");
      if (!known.has(config.serviceNames.app ?? "app")) add("development-compose", "error", "Effective development configuration omits the configured app service.", "Restore the app in the selected override or correct ship.json serviceNames.app. Ship up and app proxies require that service.");
      if (projectName !== config.name) add("compose-project", "warning", "Effective development project identity differs from ship.json; container checks use the effective identity.", "Review the selected override, COMPOSE_PROJECT_NAME and .env before renaming a stack. Stop the previous project explicitly when needed; doctor does not inspect previous project identities.");
      if (known.size !== expected.size) add("compose-profiles", "warning", "Profiled services are checked when present; absent profiled services are not reported as missing.", "Review profile activation separately. Doctor does not establish which optional services you intend to start.");
    } catch (error) { propagateCancellation(error); add("development-compose", "error", "Could not validate the effective development Compose configuration.", "Check the selected override YAML, interpolation variables, referenced files and service dependencies. Container checks are skipped because the effective project identity is unknown; raw Compose output is omitted."); }
  }
  if (config && projectName && daemon && compose) {
    try {
      const ids = (await execute(["docker", "ps", "--all", "--filter", `label=com.docker.compose.project=${projectName}`, "--format", "{{.ID}}"], probeRoot, { capture: true })).trim().split(/\s+/).filter(Boolean);
      if (ids.some(id => !/^[a-f0-9]{12,64}$/.test(id))) throw new Error("Invalid container IDs");
      const rows: unknown[] = ids.length ? (await execute(["docker", "inspect", "--format", INSPECT, ...ids], probeRoot, { capture: true })).trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as unknown) : [];
      const seen = new Set<string>();
      for (const row of rows) {
        if (!row || typeof row !== "object" || !("service" in row) || typeof row.service !== "string" || !("state" in row) || typeof row.state !== "string") throw new Error("Invalid container metadata");
        if ("oneoff" in row && String(row.oneoff).toLowerCase() === "true") continue;
        const service = clean(row.service);
        const logs = `Run ship logs ${service} and review docs/recovery.md.`;
        seen.add(row.service);
        if (known && !known.has(row.service)) {
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
