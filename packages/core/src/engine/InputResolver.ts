import type { Ref } from "../contracts/dtos.js";
import { SchemaValidationError } from "../errors/index.js";

/**
 * Resolve a dotted-path string against an object.
 * "a.b.c" → obj.a.b.c
 * Returns undefined if any segment is missing.
 */
function getPath(obj: unknown, path: string): unknown {
  if (path === "") return obj;
  const segments = path.split(".");
  let cur: unknown = obj;
  for (const seg of segments) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

export class InputResolver {
  /**
   * Resolve a full inputMapping for a step.
   * @param mapping  Record<fieldName, Ref>
   * @param trigger  The original chain trigger payload
   * @param stepOutputs  Map<stepId, output> of all prior steps
   */
  resolve(
    mapping: Record<string, Ref>,
    trigger: Record<string, unknown>,
    stepOutputs: Map<string, unknown>,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [field, ref] of Object.entries(mapping)) {
      result[field] = this.resolveRef(field, ref, trigger, stepOutputs);
    }
    return result;
  }

  private resolveRef(
    field: string,
    ref: Ref,
    trigger: Record<string, unknown>,
    stepOutputs: Map<string, unknown>,
  ): unknown {
    // Literal ref — discriminated by absence of 'from' key
    if (!("from" in ref)) {
      // LiteralRef: { value: unknown }
      return (ref as { value?: unknown }).value;
    }

    const fromRef = ref as { from: string; path: string };

    // Trigger ref
    if (fromRef.from === "trigger") {
      const val = getPath(trigger, fromRef.path);
      if (val === undefined) {
        throw new SchemaValidationError(
          `Trigger path "${fromRef.path}" not found for field "${field}"`,
          [],
        );
      }
      return val;
    }

    // Step ref
    const stepOutput = stepOutputs.get(fromRef.from);
    if (stepOutput === undefined) {
      throw new SchemaValidationError(
        `Step output for "${fromRef.from}" not available for field "${field}"`,
        [],
      );
    }
    const val = getPath(stepOutput, fromRef.path);
    if (val === undefined) {
      throw new SchemaValidationError(
        `Path "${fromRef.path}" not found in step "${fromRef.from}" output for field "${field}"`,
        [],
      );
    }
    return val;
  }
}
