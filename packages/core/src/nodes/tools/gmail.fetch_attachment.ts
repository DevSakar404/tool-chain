import { z } from "zod";
import { BaseNode } from "../../node/BaseNode.js";
import { BlobHandleSchema } from "../../contracts/dtos.js";
import type { IRunContext } from "../../contracts/IRunContext.js";

const InputSchema = z.object({ messageId: z.string().min(1) });
type Input = z.infer<typeof InputSchema>;

export class GmailFetchAttachmentNode extends BaseNode<Input, z.infer<typeof BlobHandleSchema>> {
  readonly id = "gmail.fetch_attachment";
  readonly kind = "tool" as const;
  readonly inputSchema = InputSchema;
  readonly outputSchema = BlobHandleSchema;
  readonly description =
    "Fetch the first resume-like (PDF/DOCX) attachment from a Gmail message; returns a BlobHandle.";

  protected override async run(
    input: Input,
    ctx: IRunContext,
  ): Promise<z.infer<typeof BlobHandleSchema>> {
    ctx.logger.info("Fetching Gmail attachment", { messageId: input.messageId });
    // ctx.gmail.fetchAttachment handles part-walking + base64url decode internally
    return ctx.gmail.fetchAttachment(input.messageId);
  }
}

export const gmailFetchAttachmentNode = new GmailFetchAttachmentNode();
