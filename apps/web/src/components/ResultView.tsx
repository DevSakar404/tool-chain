import type { ResumeDTO } from "@tool-chain/core";

interface Props {
  resume: ResumeDTO | null;
}

/**
 * Isolated ResultView — the gen-UI swap point (D16).
 * Replace this component's internals without touching page.tsx.
 */
export function ResultView({ resume }: Props) {
  if (!resume) return null;

  return (
    <div id="result-view" className="rounded-lg border bg-card text-card-foreground shadow-sm p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">{resume.name}</h2>
        <p className="text-sm text-muted-foreground">{resume.college}</p>
      </div>

      {resume.experience.length > 0 && (
        <section>
          <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground mb-3">
            Experience
          </h3>
          <ul className="space-y-3">
            {resume.experience.map((exp, i) => (
              <li key={i} className="flex flex-col">
                <span className="font-medium">
                  {exp.role} — {exp.company}
                </span>
                <span className="text-xs text-muted-foreground">
                  {exp.startDate}
                  {exp.endDate ? ` → ${exp.endDate}` : " → Present"}
                </span>
                {exp.summary && (
                  <span className="text-sm text-muted-foreground mt-1">{exp.summary}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {resume.keyProjects.length > 0 && (
        <section>
          <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground mb-3">
            Key Projects
          </h3>
          <ul className="flex flex-wrap gap-2">
            {resume.keyProjects.map((p, i) => (
              <li
                key={i}
                className="rounded-full bg-secondary text-secondary-foreground px-3 py-1 text-xs font-medium"
              >
                {p}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
