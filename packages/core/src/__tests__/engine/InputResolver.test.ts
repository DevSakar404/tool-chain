import { describe, it, expect } from "vitest";
import { InputResolver } from "../../engine/InputResolver.js";
import { SchemaValidationError } from "../../errors/index.js";

const resolver = new InputResolver();

describe("InputResolver", () => {
  const trigger = { fileId: "file-abc", nested: { key: "val" } };
  const stepOutputs = new Map<string, unknown>([
    ["s1", { blob: { storageRef: "blobs/abc" } }],
  ]);

  it("resolves trigger ref", () => {
    const result = resolver.resolve(
      { fileId: { from: "trigger", path: "fileId" } },
      trigger,
      stepOutputs,
    );
    expect(result["fileId"]).toBe("file-abc");
  });

  it("resolves nested trigger ref", () => {
    const result = resolver.resolve(
      { k: { from: "trigger", path: "nested.key" } },
      trigger,
      stepOutputs,
    );
    expect(result["k"]).toBe("val");
  });

  it("resolves step ref with dotted path", () => {
    const result = resolver.resolve(
      { ref: { from: "s1", path: "blob.storageRef" } },
      trigger,
      stepOutputs,
    );
    expect(result["ref"]).toBe("blobs/abc");
  });

  it("resolves literal ref", () => {
    const result = resolver.resolve(
      { x: { value: 42 } },
      trigger,
      stepOutputs,
    );
    expect(result["x"]).toBe(42);
  });

  it("throws SchemaValidationError on missing trigger path", () => {
    expect(() =>
      resolver.resolve(
        { x: { from: "trigger", path: "missing.key" } },
        trigger,
        stepOutputs,
      ),
    ).toThrow(SchemaValidationError);
  });

  it("throws SchemaValidationError on missing step output", () => {
    expect(() =>
      resolver.resolve(
        { x: { from: "s999", path: "output" } },
        trigger,
        stepOutputs,
      ),
    ).toThrow(SchemaValidationError);
  });

  it("throws SchemaValidationError on missing path in step output", () => {
    expect(() =>
      resolver.resolve(
        { x: { from: "s1", path: "missing.deep" } },
        trigger,
        stepOutputs,
      ),
    ).toThrow(SchemaValidationError);
  });
});
