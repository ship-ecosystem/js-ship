import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { ConfigError } from "./errors.js";
import type { Runner } from "./process.js";
export const mutagenEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => ["1", "true"].includes(env.SHIP_MUTAGEN?.trim().toLowerCase() ?? "");
export const syncIdentity = (root: string): string => `ship-js-${createHash("sha256").update(resolve(root)).digest("hex").slice(0, 20)}`;
export async function requireMutagen(root: string, runner: Runner): Promise<void> {
  try { await runner(["mutagen", "version"], root, { capture: true }); }
  catch { throw new ConfigError(["SHIP_MUTAGEN is enabled but Mutagen is unavailable. Install Mutagen or unset SHIP_MUTAGEN to use development bind mounts."]); }
}
export async function startSync(prefix: readonly string[], root: string, app: string, runner: Runner): Promise<void> {
  const id = syncIdentity(root), label = `io.ship.js.project=${id}`;
  const container = (await runner([...prefix, "ps", "-q", app], root, { capture: true })).trim();
  if (!/^[a-f0-9]{12,64}$/.test(container)) throw new ConfigError(["Cannot find the app container for Mutagen synchronization."]);
  // up recreates app to refresh dependencies; replace its old endpoint as well.
  await runner(["mutagen", "sync", "terminate", "--label-selector", label], root);
  try {
    await runner(["mutagen", "sync", "create", "--name", id, "--label", label, "--sync-mode", "two-way-resolved", "--ignore-vcs",
      ...["node_modules", ".ship-secrets", ".npmrc", ".env.production", ".env.production.*", "dist/ship", ".yarn/cache", ".yarn/unplugged"].flatMap(path => ["--ignore", path]),
      root, `docker://node@${container}/app`], root);
    await runner(["mutagen", "sync", "flush", "--label-selector", label], root);
    await runner([...prefix, "exec", "-T", app, "touch", "/tmp/ship-sync-ready"], root);
  } catch (error) {
    await runner(["mutagen", "sync", "terminate", "--label-selector", label], root).catch(() => {});
    throw error;
  }
}
export async function stopSync(root: string, runner: Runner): Promise<void> {
  try { await runner(["mutagen", "version"], root, { capture: true }); } catch { return; }
  await runner(["mutagen", "sync", "terminate", "--label-selector", `io.ship.js.project=${syncIdentity(root)}`], root);
}
