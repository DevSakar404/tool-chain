import { describe, it, expect } from "vitest";
import { expectedStartTimes, pacedStatus } from "@/components/editor/RunProgressBar";
import type { Step } from "@tool-chain/core";

const steps: Step[] = [
  { stepId: "s1", nodeId: "drive.download_file", inputMapping: {} },
  { stepId: "s2", nodeId: "document.extract_text", inputMapping: {} },
  { stepId: "s3", nodeId: "resume.parse_fields", inputMapping: {} },
];

describe("expectedStartTimes", () => {
  it("cumulates historical averages per step", () => {
    const starts = expectedStartTimes(steps, { s1: 1000, s2: 2000, s3: 500 });
    expect(starts).toEqual([0, 1000, 3000]);
  });

  it("falls back to the default duration for steps with no history", () => {
    const starts = expectedStartTimes(steps, {});
    expect(starts).toEqual([0, 2000, 4000]);
  });
});

describe("pacedStatus", () => {
  it("prefers real status over pacing", () => {
    expect(pacedStatus("ok", 5000, 0, true)).toBe("ok");
    expect(pacedStatus("error", 0, 9999, true)).toBe("error");
  });

  it("paces a running look once elapsed time crosses the expected start", () => {
    expect(pacedStatus(undefined, 1000, 500, true)).toBeUndefined();
    expect(pacedStatus(undefined, 1000, 1000, true)).toBe("running");
    expect(pacedStatus(undefined, 1000, 5000, true)).toBe("running");
  });

  it("never paces once the run is no longer active", () => {
    expect(pacedStatus(undefined, 0, 5000, false)).toBeUndefined();
  });
});
