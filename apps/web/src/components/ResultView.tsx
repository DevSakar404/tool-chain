import type { ResumeDTO } from "@tool-chain/core";

interface Props {
  resume: ResumeDTO | null;
}

function formatValue(value: unknown): string {
  if (value == null || value === "") return "—";
  if (Array.isArray(value)) {
    if (value.length === 0) return "—";
    if (typeof value[0] === "object") {
      return value
        .map((exp) => {
          const e = exp as ResumeDTO["experience"][number];
          const range = `${e.startDate}${e.endDate ? ` → ${e.endDate}` : " → Present"}`;
          return [`${e.role} — ${e.company} (${range})`, e.summary].filter(Boolean).join(": ");
        })
        .join("\n");
    }
    return value.join(", ");
  }
  return String(value);
}

const FIELD_LABELS: Record<keyof ResumeDTO, string> = {
  name: "Name",
  email: "Email",
  phone: "Phone",
  location: "Location",
  linkedinUrl: "LinkedIn",
  portfolioUrl: "Portfolio",
  college: "College",
  experience: "Experience",
  keyProjects: "Key Projects",
  skills: "Skills",
  certifications: "Certifications",
};

/**
 * Isolated ResultView — the gen-UI swap point (D16).
 * Replace this component's internals without touching page.tsx.
 */
export function ResultView({ resume }: Props) {
  if (!resume) return null;

  return (
    <div id="result-view" className="rounded-lg border bg-card text-card-foreground shadow-sm p-6">
      <dl className="divide-y divide-border">
        {(Object.keys(FIELD_LABELS) as Array<keyof ResumeDTO>).map((key) => (
          <div key={key} className="grid grid-cols-3 gap-4 py-2">
            <dt className="text-sm font-medium text-muted-foreground">{FIELD_LABELS[key]}</dt>
            <dd className="col-span-2 text-sm whitespace-pre-line">{formatValue(resume[key])}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
