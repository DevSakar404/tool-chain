import type { IUsageSink, TokenUsage } from "../contracts/IRunContext.js";

/**
 * Run-scoped token-usage accumulator (IUsageSink).
 *
 * One instance per run. LLM calls report usage via `add()`; the engine reads
 * the running total via `total()` when the run ends. Each field is coerced with
 * `Number.isFinite` so a provider that omits or returns NaN counts never
 * corrupts the total.
 */
export class UsageAccumulator implements IUsageSink {
  private runningTotal = 0;

  add(usage: TokenUsage): void {
    const total = usage.totalTokens;
    this.runningTotal += Number.isFinite(total) ? total : 0;
  }

  total(): number {
    return this.runningTotal;
  }
}
