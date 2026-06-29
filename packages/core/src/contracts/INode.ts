import type { ZodType } from "zod";
import type { StepResult } from "./dtos.js";
import type { IRunContext, LLMTarget } from "./IRunContext.js";

export type NodeKind = "tool" | "skill";

export interface NodeMeta {
  readonly id: string;
  readonly kind: NodeKind;
  readonly description?: string | undefined;
  /**
   * Preferred LLM for this node, if any. Tried first when the node calls the
   * LLM, falling through to the global provider chain on failure. Declared in
   * code today; destined to be sourced from a tool-registry column later.
   */
  readonly preferredLLM?: LLMTarget | undefined;
}

export interface INode<I = unknown, O = unknown> extends NodeMeta {
  readonly inputSchema: ZodType<I>;
  readonly outputSchema: ZodType<O>;
  execute(input: unknown, ctx: IRunContext): Promise<StepResult<O>>;
}
