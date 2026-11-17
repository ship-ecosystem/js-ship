import { setTimeout as delay } from "node:timers/promises";
import type { Runner } from "./process.js";
import { ConfigError } from "./errors.js";

interface StatusRecord {
  Service?: string; State?: string; Health?: string; ExitCode?: number;
  Publishers?: { TargetPort?: number; PublishedPort?: number; URL?: string }[];
}
export function statusRecords(output: string): StatusRecord[] {
  const lines = output.trim().split(/\r?\n/).filter(Boolean);
  try {
    const parsed: unknown[] = lines.map(line => JSON.parse(line) as unknown);
    return (parsed.length === 1 && Array.isArray(parsed[0]) ? parsed[0] : parsed).filter((v): v is StatusRecord => typeof v === "object" && v !== null);
  } catch { throw new ConfigError(["Docker Compose returned invalid container status JSON."]); }
}

export async function waitForStack(prefix: readonly string[], root: string, app: string, port: number, runner: Runner, timeoutMs = 180_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let pending = "containers have not started";
  while (Date.now() < deadline) {
    const records = statusRecords(await runner([...prefix, "ps", "--all", "--format", "json"], root, { capture: true }));
    const fatal = records.filter(row => ["exited", "dead", "restarting"].includes(row.State ?? "") || row.Health === "unhealthy");
    if (fatal.length) throw new ConfigError(fatal.map(row => `${row.Service} is ${row.State} (${row.Health || "no healthcheck"}); run ship logs ${row.Service}.`));
    const appRecord = records.find(row => row.Service === app);
    const published = appRecord?.Publishers?.find(p => p.TargetPort === port)?.PublishedPort;
    if (published && appRecord?.State === "running") {
      try {
        const response = await fetch(`http://127.0.0.1:${published}/`, { signal: AbortSignal.timeout(1500), redirect: "manual" });
        await response.body?.cancel();
        return published;
      } catch { pending = `app has not answered HTTP on port ${published}`; }
    } else pending = "app is not running with a published HTTP port";
    await delay(500);
  }
  throw new ConfigError([`Stack did not become ready: ${pending}. Run ship logs.`]);
}
