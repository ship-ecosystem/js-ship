import { spawn } from "node:child_process";
import { ProcessError } from "./errors.js";

export interface RunOptions { capture?: boolean; env?: NodeJS.ProcessEnv; input?: string; timeoutMs?: number }
export type Runner = (args: readonly string[], cwd: string, options?: RunOptions) => Promise<string>;
/** No host shell: argument arrays preserve spaces, quotes, dollar signs and proxy flags. */
export const run: Runner = async (args, cwd, options = {}) => {
  if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) throw new ProcessError("Process timeout must be positive.", 1);
  const [binary, ...rest] = args;
  if (!binary) throw new ProcessError("Cannot execute an empty command.", 1);
  return new Promise((resolve, reject) => {
    const child = spawn(binary, rest, { cwd, env: options.env ?? process.env, shell: false,
      stdio: options.input !== undefined ? ["pipe", options.capture ? "pipe" : "inherit", options.capture ? "pipe" : "inherit"] : options.capture ? ["ignore", "pipe", "pipe"] : "inherit" });
    let stdout = "", stderr = "", timedOut = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const timeout = options.timeoutMs === undefined ? undefined : setTimeout(() => {
      timedOut = true; child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 2000); killTimer.unref();
    }, options.timeoutMs);
    timeout?.unref();
    // A child may exit before reading stdin (for example an unsupported flag).
    child.stdin?.on("error", () => {});
    if (options.input !== undefined) child.stdin?.end(options.input);
    child.stdout?.on("data", (data: Buffer) => { stdout += data.toString(); });
    child.stderr?.on("data", (data: Buffer) => { stderr += data.toString(); });
    const forward = (signal: NodeJS.Signals) => { child.kill(signal); };
    const interrupt = () => forward("SIGINT");
    const terminate = () => forward("SIGTERM");
    process.on("SIGINT", interrupt); process.on("SIGTERM", terminate);
    const cleanup = () => { clearTimeout(timeout); clearTimeout(killTimer); process.off("SIGINT", interrupt); process.off("SIGTERM", terminate); };
    child.once("error", error => { cleanup(); reject(new ProcessError(`Cannot run ${binary}: ${error.message}`, 1)); });
    child.once("close", (code, signal) => {
      cleanup();
      if (timedOut) reject(new ProcessError(`${binary} timed out after ${options.timeoutMs}ms.`, 124, stdout, stderr));
      else if (code === 0) resolve(stdout);
      else reject(new ProcessError(`${binary} ${rest.slice(0, 2).join(" ")} failed${signal ? ` (${signal})` : ""}${stderr.trim() ? `: ${stderr.trim()}` : ""}`, code ?? (signal === "SIGINT" ? 130 : 143), stdout, stderr));
    });
  });
};
