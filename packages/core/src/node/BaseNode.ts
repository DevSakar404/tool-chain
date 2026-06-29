import { type ZodType, ZodError } from "zod";
import type { INode, NodeKind } from "../contracts/INode.js";
import type { IRunContext, LLMTarget } from "../contracts/IRunContext.js";
import type { StepResult, SafeError } from "../contracts/dtos.js";

function toSafeError(e: unknown): SafeError {
  if (e instanceof Error) {
    const code = (e as Error & { code?: string }).code;
    const safe: SafeError = { name: e.name, message: e.message };
    if (code !== undefined) safe.code = code;
    return safe;
  }
  return { name: "UnknownError", message: String(e) };
}

export abstract class BaseNode<I, O> implements INode<I, O> {
  abstract readonly id: string;
  abstract readonly kind: NodeKind;
  abstract readonly inputSchema: ZodType<I>;
  abstract readonly outputSchema: ZodType<O>;

  /**
   * Preferred LLM for this node; undefined means defer to the global default
   * provider. Subclasses override with a concrete target to pin a provider.
   */
  readonly preferredLLM?: LLMTarget | undefined;

  /**
   * Subclasses implement this; `input` is already Zod-validated.
   */
  protected abstract run(input: I, ctx: IRunContext): Promise<O>;

  async execute(rawInput: unknown, ctx: IRunContext): Promise<StepResult<O>> {
    // --- validate input ---
    const inputParsed = this.inputSchema.safeParse(rawInput);
    if (!inputParsed.success) {
      ctx.logger.warn("InputInvalid", { nodeId: this.id, issues: inputParsed.error.issues });
      return {
        ok: false,
        kind: "InputInvalid",
        error: toSafeError(inputParsed.error),
      };
    }

    // --- run node ---
    let output: O;
    try {
      output = await this.run(inputParsed.data, ctx);
    } catch (e) {
      ctx.logger.error("NodeError", { nodeId: this.id, error: toSafeError(e) });
      return {
        ok: false,
        kind: "NodeError",
        error: toSafeError(e),
      };
    }

    // --- validate output ---
    const outputParsed = this.outputSchema.safeParse(output);
    if (!outputParsed.success) {
      ctx.logger.error("OutputInvalid", { nodeId: this.id, issues: outputParsed.error.issues });
      return {
        ok: false,
        kind: "OutputInvalid",
        error: toSafeError(outputParsed.error),
      };
    }

    return { ok: true, output: outputParsed.data };
  }
}

/**
 * Re-export helper for use in di/buildEngine and tests.
 */
export { toSafeError };
