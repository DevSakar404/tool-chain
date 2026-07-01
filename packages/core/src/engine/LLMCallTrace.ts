import type { ILLMCallTraceSink } from "../contracts/IRunContext.js";

/**
 * Run-scoped LLM call trace (ILLMCallTraceSink). One instance per run; a skill
 * node's `onResult` callback calls `set()`, and the engine calls `takeLast()`
 * right after `node.execute` returns so the trace attaches to the correct step
 * and never bleeds into the next one.
 */
export class LLMCallTrace implements ILLMCallTraceSink {
  private last: { target: string; fallbackUsed: boolean } | undefined;

  set(target: string, fallbackUsed: boolean): void {
    this.last = { target, fallbackUsed };
  }

  takeLast(): { target: string; fallbackUsed: boolean } | undefined {
    const last = this.last;
    this.last = undefined;
    return last;
  }
}
