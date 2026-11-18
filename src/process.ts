import { spawn } from "node:child_process";
import { ProcessError } from "./errors.js";

export interface RunOptions { capture?: boolean; env?: NodeJS.ProcessEnv; input?: string }
export type Runner = (args: readonly string[], cwd: string, options?: RunOptions) => Promise<string>;
/** No host shell: argument arrays preserve spaces, quotes, dollar signs and proxy flags. */
export const run: Runner = async (args, cwd, options = {}) => {
  const [binary, ...rest] = args;
  if (!binary) throw new ProcessError("Cannot execute an empty command.", 1);
  return new Promise((resolve, reject) => {
    const child = spawn(binary, rest, { cwd, env: options.env ?? process.env, shell: false,
      stdio: options.input !== undefined ? ["pipe", options.capture ? "pipe" : "inherit", options.capture ? "pipe" : "inherit"] : options.capture ? ["ignore", "pipe", "pipe"] : "inherit" });
    let stdout = "", stderr = "";
    // A child may exit before reading stdin (for example an unsupported flag).
    child.stdin?.on("error", () => {});
    if (options.input !== undefined) child.stdin?.end(options.input);
    child.stdout?.on("data", (data: Buffer) => { stdout += data.toString(); });
    child.stderr?.on("data", (data: Buffer) => { stderr += data.toString(); });
    const forward = (signal: NodeJS.Signals) => { child.kill(signal); };
    const interrupt = () => forward("SIGINT");
    const terminate = () => forward("SIGTERM");
    process.on("SIGINT", interrupt); process.on("SIGTERM", terminate);
    const cleanup = () => { process.off("SIGINT", interrupt); process.off("SIGTERM", terminate); };
    child.once("error", error => { cleanup(); reject(new ProcessError(`Cannot run ${binary}: ${error.message}`, 1)); });
    child.once("close", (code, signal) => {
      cleanup();
      if (code === 0) resolve(stdout);
      else reject(new ProcessError(`${binary} ${rest.slice(0, 2).join(" ")} failed${signal ? ` (${signal})` : ""}${stderr.trim() ? `: ${stderr.trim()}` : ""}`, code ?? (signal === "SIGINT" ? 130 : 143), stdout, stderr));
    });
  });
};
