import type { ZodTypeAny } from "zod";
import type { INode } from "../contracts/INode.js";
import type { LLMTarget } from "../contracts/IRunContext.js";

export interface NodeFieldDescriptor {
  name: string;
  type: string;      // "string" | "number" | "boolean" | "object" | "unknown"
  required: boolean;
}

export interface NodeCatalogEntry {
  id: string;
  kind: "tool" | "skill";
  description?: string;
  inputFields: NodeFieldDescriptor[];
  outputFields: NodeFieldDescriptor[];
  /** The node's preferred LLM, if it declares one (future registry column). */
  preferredLLM?: LLMTarget;
}

function zodTypeLabel(schema: ZodTypeAny): string {
  const def = schema._def as { typeName?: string };
  const typeName: string = def?.typeName ?? "";
  if (typeName === "ZodString") return "string";
  if (typeName === "ZodNumber") return "number";
  if (typeName === "ZodBoolean") return "boolean";
  // Arrays, objects, unions, enums, etc. → "object"
  return "object";
}

function describeObjectSchema(schema: ZodTypeAny): NodeFieldDescriptor[] {
  const def = schema._def as { typeName?: string; schema?: ZodTypeAny; shape?: () => Record<string, ZodTypeAny> };
  const typeName: string = def?.typeName ?? "";

  // Unwrap ZodEffects (e.g. .refine()) — LiteralRefSchema uses .refine()
  if (typeName === "ZodEffects") {
    return describeObjectSchema(def.schema as ZodTypeAny);
  }

  if (typeName !== "ZodObject") {
    // Non-object schema: single synthetic field named "value"
    return [{ name: "value", type: zodTypeLabel(schema), required: true }];
  }

  const shape = def.shape!() as Record<string, ZodTypeAny>;
  return Object.entries(shape).map(([name, fieldSchema]) => {
    const fieldDef = (fieldSchema as ZodTypeAny)._def as { typeName?: string; innerType?: ZodTypeAny };
    const isOptional = fieldDef?.typeName === "ZodOptional";
    const innerSchema: ZodTypeAny = isOptional
      ? (fieldDef.innerType as ZodTypeAny)
      : (fieldSchema as ZodTypeAny);
    return {
      name,
      type: zodTypeLabel(innerSchema),
      required: !isOptional,
    };
  });
}

export function describeNode(node: INode): NodeCatalogEntry {
  const entry: NodeCatalogEntry = {
    id: node.id,
    kind: node.kind,
    inputFields: describeObjectSchema(node.inputSchema as unknown as ZodTypeAny),
    outputFields: describeObjectSchema(node.outputSchema as unknown as ZodTypeAny),
  };
  if (node.description !== undefined) {
    entry.description = node.description;
  }
  if (node.preferredLLM !== undefined) {
    entry.preferredLLM = node.preferredLLM;
  }
  return entry;
}
