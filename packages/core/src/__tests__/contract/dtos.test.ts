import { describe, it, expect } from "vitest";
import {
  ChainSchema,
  StepSchema,
  RefSchema,
  BlobHandleSchema,
} from "../../contracts/dtos.js";

describe("RefSchema", () => {
  it("parses trigger ref", () => {
    const r = RefSchema.parse({ from: "trigger", path: "fileId" });
    expect(r).toEqual({ from: "trigger", path: "fileId" });
  });

  it("parses step ref", () => {
    const r = RefSchema.parse({ from: "s1", path: "output.text" });
    expect(r).toEqual({ from: "s1", path: "output.text" });
  });

  it("parses literal ref", () => {
    const r = RefSchema.parse({ value: 42 });
    expect(r).toEqual({ value: 42 });
  });

  it("rejects empty object", () => {
    expect(() => RefSchema.parse({})).toThrow();
  });
});

describe("StepSchema", () => {
  it("parses valid step", () => {
    const step = StepSchema.parse({
      stepId: "s1",
      nodeId: "drive.download_file",
      inputMapping: {
        fileId: { from: "trigger", path: "fileId" },
      },
    });
    expect(step.stepId).toBe("s1");
  });

  it("rejects missing nodeId", () => {
    expect(() =>
      StepSchema.parse({ stepId: "s1", inputMapping: {} }),
    ).toThrow();
  });
});

describe("ChainSchema", () => {
  it("parses valid chain", () => {
    const chain = ChainSchema.parse({
      id: "00000000-0000-0000-0000-000000000001",
      name: "Resume chain",
      schemaVersion: 1,
      steps: [
        {
          stepId: "s1",
          nodeId: "drive.download_file",
          inputMapping: { fileId: { from: "trigger", path: "fileId" } },
        },
      ],
    });
    expect(chain.steps).toHaveLength(1);
  });

  it("rejects chain with empty steps", () => {
    expect(() =>
      ChainSchema.parse({
        id: "00000000-0000-0000-0000-000000000001",
        name: "test",
        schemaVersion: 1,
        steps: [],
      }),
    ).toThrow();
  });

  it("rejects non-uuid id", () => {
    expect(() =>
      ChainSchema.parse({
        id: "not-a-uuid",
        name: "test",
        schemaVersion: 1,
        steps: [{ stepId: "s1", nodeId: "n", inputMapping: {} }],
      }),
    ).toThrow();
  });
});

describe("BlobHandleSchema", () => {
  it("parses valid blob handle", () => {
    const b = BlobHandleSchema.parse({
      storageRef: "pipeline-blobs/abc.pdf",
      mime: "application/pdf",
      size: 1024,
      sha256: "abc123",
    });
    expect(b.size).toBe(1024);
  });

  it("rejects negative size", () => {
    expect(() =>
      BlobHandleSchema.parse({
        storageRef: "ref",
        mime: "application/pdf",
        size: -1,
        sha256: "abc",
      }),
    ).toThrow();
  });
});
