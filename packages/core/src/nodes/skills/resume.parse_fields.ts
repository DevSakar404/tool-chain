import { z } from "zod";
import { BaseNode } from "../../node/BaseNode.js";
import type { IRunContext } from "../../contracts/IRunContext.js";

// ── ResumeDTO schema ───────────────────────────────────────────────────────────
const ExperienceSchema = z.object({
  company: z.string(),
  role: z.string(),
  startDate: z.string(),
  endDate: z.string().optional(),
  summary: z.string().optional(),
});

export const ResumeDTOSchema = z.object({
  name: z.string(),
  experience: z.array(ExperienceSchema),
  keyProjects: z.array(z.string()),
  college: z.string(),
});

export type ResumeDTO = z.infer<typeof ResumeDTOSchema>;

const InputSchema = z.object({ text: z.string().min(1) });
type Input = z.infer<typeof InputSchema>;

const SYSTEM_PROMPT = `You are a precise resume parser.
Extract structured data from the provided resume text.
Return ONLY the JSON object matching the schema — no explanation, no markdown fences.
For experience entries include company, role, startDate (YYYY-MM format), and optionally endDate and summary.
If a field cannot be determined, use an empty string or empty array.`;

export class ResumeParseFieldsNode extends BaseNode<Input, ResumeDTO> {
  readonly id = "resume.parse_fields";
  readonly kind = "skill" as const;
  readonly inputSchema = InputSchema;
  readonly outputSchema = ResumeDTOSchema;
  readonly description =
    "Parse raw resume text into a structured ResumeDTO using LLM generateObject. Malformed output → OutputInvalid.";

  protected override async run(input: Input, ctx: IRunContext): Promise<ResumeDTO> {
    ctx.logger.info("Parsing resume fields", { textLength: input.text.length });
    return ctx.llm.generateObject<ResumeDTO>(ResumeDTOSchema, SYSTEM_PROMPT, input);
  }
}

export const resumeParseFieldsNode = new ResumeParseFieldsNode();
