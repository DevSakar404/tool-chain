import { z } from "zod";
import { BaseNode } from "../../node/BaseNode.js";
import { BlobHandleSchema } from "../../contracts/dtos.js";
import type { IRunContext } from "../../contracts/IRunContext.js";

const InputSchema = z.object({ fileId: z.string().min(1) });
type Input = z.infer<typeof InputSchema>;

export class DriveDownloadFileNode extends BaseNode<Input, z.infer<typeof BlobHandleSchema>> {
  readonly id = "drive.download_file";
  readonly kind = "tool" as const;
  readonly inputSchema = InputSchema;
  readonly outputSchema = BlobHandleSchema;
  readonly description = "Download or export a Google Drive file to Storage; returns a BlobHandle.";

  protected override async run(
    input: Input,
    ctx: IRunContext,
  ): Promise<z.infer<typeof BlobHandleSchema>> {
    ctx.logger.info("Downloading Drive file", { fileId: input.fileId });
    // ctx.drive.download handles export-vs-download branching internally (D13)
    return ctx.drive.download(input.fileId);
  }
}

export const driveDownloadFileNode = new DriveDownloadFileNode();
