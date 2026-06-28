import { generateObject as aiGenerateObject } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { ZodType } from "zod";
import type { ILLMProvider } from "../../contracts/IRunContext.js";

export interface VercelAILLMProviderOptions {
  apiKey: string;
  model?: string | undefined;
}

export class VercelAILLMProvider implements ILLMProvider {
  private readonly model: ReturnType<ReturnType<typeof createAnthropic>>;

  constructor(opts: VercelAILLMProviderOptions) {
    const anthropic = createAnthropic({ apiKey: opts.apiKey });
    this.model = anthropic(opts.model ?? "claude-haiku-4-5-20251001");
  }

  async generateObject<T>(
    schema: ZodType<T>,
    systemPrompt: string,
    userInput: unknown,
  ): Promise<T> {
    const { object } = await aiGenerateObject({
      model: this.model,
      schema,
      system: systemPrompt,
      prompt: JSON.stringify(userInput),
    });
    return object;
  }
}
