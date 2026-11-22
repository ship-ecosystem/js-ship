import type { InitQuestion, AskInit } from "./interactive.js";
/** Prompt renderers use this token; replay preserves earlier answers without writes. */
export const BACK = ":back";
export class WizardBack extends Error {}
export async function runWizard<T>(collect: (ask: AskInit) => Promise<T>, ask: AskInit): Promise<T> {
  const saved = new Map<string, string>();
  const prefill = new Map<string, string>();
  let history: string[] = [];
  for (;;) {
    history = [];
    try {
      return await collect(async question => {
        if (saved.has(question.key)) { history.push(question.key); return saved.get(question.key)!; }
        const current: InitQuestion = { ...question, defaultValue: prefill.get(question.key) ?? question.defaultValue };
        const response = await ask(current);
        if (response === BACK) throw new WizardBack();
        // Invalid answers are retried by the domain collector, not cached.
        const value = response.trim() || current.defaultValue;
        const choices = value === "none" && question.multiple ? [] : value.split(",").map(v => v.trim());
        if ((!question.choices || (question.multiple ? choices.every(v => question.choices!.includes(v)) : question.choices.includes(value))) && (!question.validate || question.validate(value))) {
          saved.set(question.key, value); prefill.set(question.key, value); history.push(question.key);
        }
        return response;
      });
    } catch (error) {
      if (!(error instanceof WizardBack)) throw error;
      const target = history.at(-1);
      if (!target) continue;
      // Everything following the previous question is recomputed, including
      // conditional branches after workspace/framework/deployment changes.
      saved.delete(target);
      let remove = false;
      for (const key of prefill.keys()) { if (key === target) remove = true; else if (remove) prefill.delete(key); }
    }
  }
}
