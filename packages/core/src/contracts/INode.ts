import type { ZodType } from "zod";
import type { StepResult } from "./dtos.js";
import type { IRunContext } from "./IRunContext.js";

export type NodeKind = "tool" | "skill";

export interface NodeMeta {
  readonly id: string;
  readonly kind: NodeKind;
  readonly description?: string | undefined;
}

export interface INode<I = unknown, O = unknown> extends NodeMeta {
  readonly inputSchema: ZodType<I>;
  readonly outputSchema: ZodType<O>;
  execute(input: unknown, ctx: IRunContext): Promise<StepResult<O>>;
}
