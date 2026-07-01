import { type ZodType } from "zod";
import { BaseNode } from "./BaseNode.js";
import type { IRunContext, LLMTarget } from "../contracts/IRunContext.js";

export class SkillNode<I, O> extends BaseNode<I, O> {
  readonly kind = "skill" as const;

  constructor(
    readonly id: string,
    readonly inputSchema: ZodType<I>,
    readonly outputSchema: ZodType<O>,
    private readonly systemPrompt: string,
    readonly description?: string,
    override readonly preferredLLM?: LLMTarget,
  ) {
    super();
  }

  protected override async run(input: I, ctx: IRunContext): Promise<O> {
    return ctx.llm.generateObject<O>(
      this.outputSchema,
      this.systemPrompt,
      input,
      this.preferredLLM,
      (result) => {
        ctx.usage.add(result.usage);
        // Log the provider trace identifiers against the run so this LLM call
        // can be correlated to a specific Anthropic API request.
        ctx.logger.info("LLM call", {
          nodeId: this.id,
          target: result.target,
          messageId: result.messageId,
          requestId: result.requestId,
          totalTokens: result.usage.totalTokens,
        });
      },
    );
  }
}
