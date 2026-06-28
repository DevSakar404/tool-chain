import { describe, it, expect } from "vitest";
import { z } from "zod";
import { describeNode } from "../../registry/describeNode.js";
import { driveDownloadFileNode } from "../../nodes/tools/drive.download_file.js";
import { documentExtractTextNode } from "../../nodes/tools/document.extract_text.js";
import { resumeParseFieldsNode } from "../../nodes/skills/resume.parse_fields.js";

describe("describeNode", () => {
  it("describes drive.download_file input fields", () => {
    const entry = describeNode(driveDownloadFileNode);
    expect(entry.id).toBe("drive.download_file");
    expect(entry.kind).toBe("tool");
    const fileIdField = entry.inputFields.find((f) => f.name === "fileId");
    expect(fileIdField).toBeDefined();
    expect(fileIdField?.type).toBe("string");
    expect(fileIdField?.required).toBe(true);
  });

  it("describes drive.download_file output fields (BlobHandle)", () => {
    const entry = describeNode(driveDownloadFileNode);
    const storageRef = entry.outputFields.find((f) => f.name === "storageRef");
    const size = entry.outputFields.find((f) => f.name === "size");
    expect(storageRef?.type).toBe("string");
    expect(storageRef?.required).toBe(true);
    expect(size?.type).toBe("number");
  });

  it("describes document.extract_text flat BlobHandle input", () => {
    const entry = describeNode(documentExtractTextNode);
    expect(entry.inputFields.map((f) => f.name)).toEqual(
      expect.arrayContaining(["storageRef", "mime", "size", "sha256"]),
    );
  });

  it("describes resume.parse_fields", () => {
    const entry = describeNode(resumeParseFieldsNode);
    expect(entry.kind).toBe("skill");
    const textField = entry.inputFields.find((f) => f.name === "text");
    expect(textField?.type).toBe("string");
    expect(textField?.required).toBe(true);
  });

  it("collapses nested object outputs to type 'object'", () => {
    const entry = describeNode(resumeParseFieldsNode);
    // experience is an array → collapses to 'object'
    const exp = entry.outputFields.find((f) => f.name === "experience");
    expect(exp?.type).toBe("object");
  });

  it("marks optional ZodOptional fields as required=false", () => {
    const syntheticNode = {
      id: "test.synthetic",
      kind: "tool" as const,
      description: "Synthetic test node",
      inputSchema: z.object({
        required_field: z.string(),
        optional_field: z.string().optional(),
      }),
      outputSchema: z.object({ result: z.string() }),
      execute: async () => ({ ok: true as const, output: { result: "" } }),
    };
    const entry = describeNode(syntheticNode as unknown as import("../../contracts/INode.js").INode);
    const requiredField = entry.inputFields.find((f) => f.name === "required_field");
    const optionalField = entry.inputFields.find((f) => f.name === "optional_field");
    expect(requiredField?.required).toBe(true);
    expect(optionalField?.required).toBe(false);
  });
});
