import type { NodeRegistry } from "../registry/NodeRegistry.js";
import { driveDownloadFileNode } from "./tools/drive.download_file.js";
import { documentExtractTextNode } from "./tools/document.extract_text.js";
import { resumeParseFieldsNode } from "./skills/resume.parse_fields.js";

export function registerAll(registry: NodeRegistry): void {
  registry.register(driveDownloadFileNode);
  registry.register(documentExtractTextNode);
  registry.register(resumeParseFieldsNode);
}

export { driveDownloadFileNode, documentExtractTextNode, resumeParseFieldsNode };
export { ResumeDTOSchema, type ResumeDTO } from "./skills/resume.parse_fields.js";
