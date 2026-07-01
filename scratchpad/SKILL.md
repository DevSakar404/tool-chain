---
name: drive-resume-extract
description: >-
  Use this skill whenever the user wants to pull a file from Google Drive and turn it into structured
  resume data — e.g. "parse the resume in Drive", "extract fields from this CV", "get the candidate file
  from Drive and give me the structured JSON", or any request involving a Drive file (id, link, or name)
  plus extracting a person's name, experience, projects, or college. Trigger it even when the user mentions
  only one part of the chain ("read this Drive resume", "format this CV"), because the full
  fetch → extract → parse pipeline is almost always what they want. IMPORTANT: extract the document's TEXT
  via the extract_document tool — do NOT try to download raw file bytes, because binary content does not
  relay over the tool channel and that path fails. Returns a fixed resume-shaped JSON object.
---

# Drive Resume Extract

Turn a Google Drive file into a structured, validated resume JSON object.

The hard-won lesson baked into this skill: **never route a Drive file through a raw-bytes download.** The
download tools return file *metadata* but the binary payload does not relay over the tool channel, so any
"download the PDF then parse the bytes" approach dead-ends. Instead, use the tool that returns a **text
representation** of the document (`extract_document`). Text relays fine; bytes don't.

## The pipeline

Run these steps in order. Each step feeds the next — don't skip one or fabricate its output.

### Step 1 — Locate the file in Drive

The user gives a Drive file id, a share link, or a filename.

- If it's a URL like `https://drive.google.com/file/d/<file_id>/view`, the id is the segment after `/d/`.
- If it's a filename, find the file first. Use `list_integrations` to confirm the Google Drive integration
  is connected, then `run_integration_tool` to call the Drive "search / get file" action and resolve the id.
- If you can't determine a file id, ask the user for the Drive link or id and stop — guessing fails or
  fetches the wrong file.

### Step 2 — Extract the document text (the critical step)

Call **`extract_document`** with the Drive file id / reference to get the document's plain text. This is the
step that makes the whole pipeline work in this environment:

- `extract_document` returns a natural-language **text** representation (it handles PDF, DOCX, Google Docs,
  and OCRs images). Because the output is text, it is not subject to the binary-relay limitation that breaks
  the download tools.
- **Do not** call a download-file / request-download tool to get raw bytes and parse them yourself. Those
  return only metadata here and the async download path is unreliable — this is the exact failure this skill
  exists to avoid.
- If the extracted text comes back empty or only a handful of characters, the file is image-only (a scanned
  resume that didn't OCR) or empty. Don't invent fields — report that no extractable text was found and stop.

If extraction tooling is unavailable and the file already lives in the workspace as text, `ws_read` is an
acceptable fallback to read it.

### Step 3 — Parse the text into the schema

Read the extracted text carefully and populate the schema below using only information actually present.

### Step 4 — Emit the result

Return the JSON via the harness's result mechanism (`finalize_result`, or `save_output` if you're persisting
it). The emitted payload must be the raw JSON object below and nothing else.

## Output schema

Return a single JSON object with exactly these fields:

```json
{
  "name": "string",
  "experience": [
    {
      "company": "string",
      "role": "string",
      "startDate": "YYYY-MM",
      "endDate": "YYYY-MM",
      "summary": "string"
    }
  ],
  "keyProjects": ["string"],
  "college": "string"
}
```

Rules that keep the output machine-consumable:

- **Return raw JSON only** — no explanation before or after, no ```json fences. Downstream code reads this
  directly, so any wrapper text breaks the parse.
- `startDate` / `endDate` use `YYYY-MM`. For a role the person still holds, set `endDate` to `""`.
- `endDate` and `summary` are optional per entry; use `""` when the text doesn't say.
- If a field genuinely can't be determined, use `""` (for `name`/`college`) or `[]` (for
  `experience`/`keyProjects`). Don't guess or pad with placeholder data — an empty value means "unknown",
  which is more useful downstream than a wrong guess.
- `keyProjects` is a list of short project names/descriptions, not full paragraphs.

## Example

**Extracted text (abbreviated):**

```
Jane Doe
Senior Engineer, Acme Corp — Jan 2021 to present. Led billing platform rewrite.
Engineer, Globex — 2018-2020.
Projects: Realtime fraud detection; Open-source CLI for log parsing.
B.S. Computer Science, MIT
```

**Emitted JSON:**

```json
{
  "name": "Jane Doe",
  "experience": [
    { "company": "Acme Corp", "role": "Senior Engineer", "startDate": "2021-01", "endDate": "", "summary": "Led billing platform rewrite." },
    { "company": "Globex", "role": "Engineer", "startDate": "2018-01", "endDate": "2020-12" }
  ],
  "keyProjects": ["Realtime fraud detection", "Open-source CLI for log parsing"],
  "college": "MIT"
}
```

## Failure handling

- **No file id / can't resolve filename** → ask for the Drive link or id; don't proceed.
- **Drive fetch fails** (not found / no access) → report it plainly; don't move on to extraction.
- **`extract_document` returns empty or too-short text** → report "no extractable text (file may be
  image-only or empty)"; don't fabricate a resume.
- **Tempted to download raw bytes** → don't. That path returns metadata only and the binary doesn't relay.
  Use `extract_document`. This is the single most important rule in this skill.
- **Document clearly isn't a resume** (e.g. an invoice) → return the schema with whatever maps and empty
  values elsewhere, and note that the document didn't look like a resume.
