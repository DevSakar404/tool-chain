import { z } from "zod";
import { BaseNode } from "../../node/BaseNode.js";
import { BlobHandleSchema } from "../../contracts/dtos.js";
import { ChainError } from "../../errors/index.js";
import type { IRunContext } from "../../contracts/IRunContext.js";

const OutputSchema = z.object({ text: z.string() });
type Output = z.infer<typeof OutputSchema>;

const MIN_CONTENT_LENGTH = 50;

function mimeCategory(mime: string): "pdf" | "docx" | "gdoc" | "text" | "unsupported" {
  if (mime === "application/pdf") return "pdf";
  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (mime === "application/vnd.google-apps.document") return "gdoc";
  if (mime.startsWith("text/")) return "text";
  return "unsupported";
}

export class DocumentExtractTextNode extends BaseNode<
  z.infer<typeof BlobHandleSchema>,
  Output
> {
  readonly id = "document.extract_text";
  readonly kind = "tool" as const;
  readonly inputSchema = BlobHandleSchema;
  readonly outputSchema = OutputSchema;
  readonly description =
    "Extract text from a BlobHandle (PDF/DOCX/text); min-content gate rejects empty/image-only files.";

  protected override async run(
    blob: z.infer<typeof BlobHandleSchema>,
    ctx: IRunContext,
  ): Promise<Output> {
    ctx.logger.info("Extracting text", { storageRef: blob.storageRef, mime: blob.mime });
    const bytes = await ctx.storage.download(blob.storageRef);
    const category = mimeCategory(blob.mime);

    let text: string;

    switch (category) {
      case "pdf": {
        // Dynamic import to avoid bundling issues in edge runtimes
        const pdfParse = (await import("pdf-parse")).default;
        const parsed = await pdfParse(bytes);
        text = parsed.text;
        break;
      }
      case "docx": {
        const mammoth = await import("mammoth");
        const result = await mammoth.extractRawText({ buffer: bytes });
        text = result.value;
        break;
      }
      case "gdoc":
      case "text": {
        text = bytes.toString("utf-8");
        break;
      }
      default: {
        throw new ChainError(
          `Unsupported mime type for text extraction: ${blob.mime}`,
          "UNSUPPORTED_MIME",
        );
      }
    }

    // Min-content gate (D14)
    if (text.trim().length < MIN_CONTENT_LENGTH) {
      throw new ChainError(
        `Extracted text too short (${text.trim().length} chars); file may be image-only or empty.`,
        "NO_EXTRACTABLE_TEXT",
      );
    }

    return { text: text.trim() };
  }
}

export const documentExtractTextNode = new DocumentExtractTextNode();
