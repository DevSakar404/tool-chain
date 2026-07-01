import type { ZodType } from "zod";
import type { StepResult } from "./dtos.js";
import type { IRunContext, LLMProviderName, LLMTarget } from "./IRunContext.js";

export type NodeKind = "tool" | "skill";

/** Per-step config forwarded from the chain's step JSON into node.execute. */
export interface StepConfig {
  llmProvider?: LLMProviderName;
}

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
  execute(input: unknown, ctx: IRunContext, stepConfig?: StepConfig): Promise<StepResult<O>>;
}
