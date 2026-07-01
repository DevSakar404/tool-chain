import { type ZodType } from "zod";
import { BaseNode } from "./BaseNode.js";
import type { IRunContext, LLMTarget } from "../contracts/IRunContext.js";
import type { StepConfig } from "../contracts/INode.js";

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

  protected override async run(input: I, ctx: IRunContext, stepConfig?: StepConfig): Promise<O> {
    const prefer: LLMTarget | undefined = stepConfig?.llmProvider
      ? { provider: stepConfig.llmProvider }
      : this.preferredLLM;
    return ctx.llm.generateObject<O>(
      this.outputSchema,
      this.systemPrompt,
      input,
      prefer,
      (result) => {
        ctx.usage.add(result.usage);
        if (result.target) ctx.llmTrace.set(result.target, result.fallbackUsed);
        // Log the provider trace identifiers against the run so this LLM call
        // can be correlated to a specific Anthropic API request.
        ctx.logger.info("LLM call", {
          nodeId: this.id,
          target: result.target,
          fallbackUsed: result.fallbackUsed,
          messageId: result.messageId,
          requestId: result.requestId,
          totalTokens: result.usage.totalTokens,
        });
      },
    );
  }
}
