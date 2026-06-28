import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import type { INode } from "../../contracts/INode.js";
import type { IRunContext } from "../../contracts/IRunContext.js";

/**
 * Shared conformance suite — run against any INode implementation.
 * Validates the execute() contract without coupling to internals.
 */
export function iNodeConformanceSuite<I, O>(
  name: string,
  factory: () => INode<I, O>,
  validInput: I,
  invalidInput: unknown,
  mockCtx: IRunContext,
): void {
  describe(`INode conformance: ${name}`, () => {
    it("has a non-empty string id", () => {
      const node = factory();
      expect(typeof node.id).toBe("string");
      expect(node.id.length).toBeGreaterThan(0);
    });

    it("has kind 'tool' or 'skill'", () => {
      const node = factory();
      expect(["tool", "skill"]).toContain(node.kind);
    });

    it("has a Zod inputSchema", () => {
      const node = factory();
      expect(node.inputSchema).toBeDefined();
      expect(typeof node.inputSchema.parse).toBe("function");
    });

    it("has a Zod outputSchema", () => {
      const node = factory();
      expect(node.outputSchema).toBeDefined();
      expect(typeof node.outputSchema.parse).toBe("function");
    });

    it("returns ok:true on valid input", async () => {
      const node = factory();
      const result = await node.execute(validInput, mockCtx);
      expect(result.ok).toBe(true);
    });

    it("returns ok:false kind:InputInvalid on invalid input", async () => {
      const node = factory();
      const result = await node.execute(invalidInput, mockCtx);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.kind).toBe("InputInvalid");
        expect(result.error.name).toBeDefined();
        expect(result.error.message).toBeDefined();
      }
    });

    it("error object never leaks undefined fields", async () => {
      const node = factory();
      const result = await node.execute(invalidInput, mockCtx);
      if (!result.ok) {
        expect(result.error.name).not.toBeUndefined();
        expect(result.error.message).not.toBeUndefined();
      }
    });
  });
}
