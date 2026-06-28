import { type ZodType } from "zod";
import { BaseNode } from "./BaseNode.js";
import type { IRunContext } from "../contracts/IRunContext.js";

export class ToolNode<I, O> extends BaseNode<I, O> {
  readonly kind = "tool" as const;

  constructor(
    readonly id: string,
    readonly inputSchema: ZodType<I>,
    readonly outputSchema: ZodType<O>,
    private readonly handler: (input: I, ctx: IRunContext) => Promise<O>,
    readonly description?: string,
  ) {
    super();
  }

  protected override run(input: I, ctx: IRunContext): Promise<O> {
    return this.handler(input, ctx);
  }
}
