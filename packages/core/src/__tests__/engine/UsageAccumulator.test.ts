import { describe, it, expect } from "vitest";
import { UsageAccumulator } from "../../engine/UsageAccumulator.js";

const usage = (promptTokens: number, completionTokens: number, totalTokens: number) => ({
  promptTokens,
  completionTokens,
  totalTokens,
});

describe("UsageAccumulator", () => {
  it("starts at zero", () => {
    expect(new UsageAccumulator().total()).toBe(0);
  });

  it("sums totalTokens across add() calls", () => {
    const acc = new UsageAccumulator();
    acc.add(usage(10, 5, 15));
    acc.add(usage(20, 10, 30));
    expect(acc.total()).toBe(45);
  });

  it("coerces non-finite totalTokens to zero", () => {
    const acc = new UsageAccumulator();
    acc.add(usage(10, 5, Number.NaN));
    acc.add(usage(10, 5, 15));
    expect(acc.total()).toBe(15);
  });

  it("treats a missing totalTokens (undefined) as zero", () => {
    const acc = new UsageAccumulator();
    // Simulate a provider that omits the field entirely.
    acc.add({ promptTokens: 10, completionTokens: 5 } as unknown as {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    });
    expect(acc.total()).toBe(0);
  });
});
