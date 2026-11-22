import { createInterface, emitKeypressEvents } from "node:readline";
import type { AskInit } from "./interactive.js";
import { BACK } from "./wizard.js";
import { ProcessError } from "./errors.js";

export interface TerminalPrompter { ask: AskInit; inform(message: string): void; close(): void }
export const richTerminal = (): boolean => !!process.stdin.isTTY && !!process.stdout.isTTY && process.env.TERM !== "dumb" && process.env.NO_COLOR === undefined;
export async function terminalInitPrompter(): Promise<TerminalPrompter> {
  if (!richTerminal()) return plainPrompter();
  const prompts = await import("@clack/prompts");
  const wasRaw = !!process.stdin.isRaw, wasPaused = process.stdin.isPaused();
  let closed = false, active: AbortController | undefined, backwards = false, terminated = false;
  const restore = () => {
    if (closed) return;
    closed = true;
    process.stdout.write("\x1b[?25h\x1b[?1049l");
    process.stdin.off("keypress", keypress);
    process.off("exit", restore); process.off("SIGTERM", terminate);
    if (process.stdin.isTTY) process.stdin.setRawMode(wasRaw);
    if (wasPaused) process.stdin.pause();
  };
  const keypress = (_text: string, key: { ctrl?: boolean; name?: string }) => { if (key?.ctrl && key.name === "u") { backwards = true; active?.abort(); } };
  const terminate = () => { terminated = true; active?.abort(); };
  process.stdout.write("\x1b[?1049h\x1b[2J\x1b[H");
  emitKeypressEvents(process.stdin);
  process.stdin.on("keypress", keypress);
  process.on("exit", restore); process.on("SIGTERM", terminate);
  prompts.intro("JavaScript Ship");
  prompts.log.info("Configure your development and production environment. Ctrl+U: back · Ctrl+C: cancel.");
  return {
    inform: message => prompts.log.info(message),
    ask: async question => {
      backwards = false;
      active = new AbortController();
      const common = { message: question.label, signal: active.signal };
      let answer: string | string[] | symbol;
      try {
        if (question.multiple && question.choices) answer = await prompts.multiselect({ ...common, required: false,
          options: question.choices.map(value => ({ value, label: value })), initialValues: question.defaultValue === "none" ? [] : question.defaultValue.split(",").filter(v => question.choices!.includes(v)) });
        else if (question.choices) answer = await prompts.select({ ...common,
          options: [...question.choices.map(value => ({ value, label: value })), { value: BACK, label: "← Back" }], initialValue: question.defaultValue });
        else answer = await prompts.text({ ...common, initialValue: question.defaultValue,
          validate: value => !question.validate || question.validate(value || question.defaultValue) || value === BACK ? undefined : "Enter a valid value." });
      } finally { active = undefined; }
      if (backwards) return BACK;
      if (terminated) throw new ProcessError("Initialization terminated; no files written.", 143);
      if (prompts.isCancel(answer)) { prompts.cancel("Cancelled; no files written."); throw new ProcessError("Initialization cancelled; no files written.", 130); }
      return Array.isArray(answer) ? answer.join(",") || "none" : String(answer);
    },
    close: restore,
  };
}
function plainPrompter(): TerminalPrompter {
  const terminal = createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY && process.env.TERM !== "dumb" });
  const lines = terminal[Symbol.asyncIterator]();
  let interrupted = false;
  terminal.on("SIGINT", () => { interrupted = true; terminal.close(); });
  return {
    inform: message => process.stdout.write(`${message}\n`),
    ask: async question => {
      if (question.choices) process.stdout.write(question.choices.map((choice, i) => `  ${i + 1}. ${choice}`).join("\n") + "\n");
      process.stdout.write(`${question.label}${question.multiple ? " (comma-separated numbers; none to clear)" : ""} [${question.defaultValue}] (:back to return): `);
      const line = await lines.next();
      if (line.done) throw new ProcessError(interrupted ? "Initialization cancelled; no files written." : "Input closed; initialization cancelled without writing files.", interrupted ? 130 : 1);
      const value = line.value.trim();
      if (!question.choices || !value || value === BACK || value === "none") return value;
      return value.split(",").map(part => /^\d+$/.test(part.trim()) ? question.choices![Number(part.trim()) - 1] ?? part.trim() : part.trim()).join(",");
    },
    close: () => terminal.close(),
  };
}
