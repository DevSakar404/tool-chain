import { type ZodType } from "zod";
import { BaseNode } from "./BaseNode.js";
import type { IRunContext } from "../contracts/IRunContext.js";

export class SkillNode<I, O> extends BaseNode<I, O> {
  readonly kind = "skill" as const;

  constructor(
    readonly id: string,
    readonly inputSchema: ZodType<I>,
    readonly outputSchema: ZodType<O>,
    private readonly systemPrompt: string,
    readonly description?: string,
  ) {
    super();
  }

  protected override async run(input: I, ctx: IRunContext): Promise<O> {
    return ctx.llm.generateObject<O>(this.outputSchema, this.systemPrompt, input);
  }
}
