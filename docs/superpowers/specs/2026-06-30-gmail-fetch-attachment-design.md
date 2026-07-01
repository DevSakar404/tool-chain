# Gmail Resume-Fetch Tool — Design Spec

**Date:** 2026-06-30
**Status:** Approved (design); pending implementation
**Related:** [`docs/ARCHITECTURE.md`](../../ARCHITECTURE.md)

## Goal

Add a `gmail.fetch_attachment` node that fetches a resume **attachment** from a
Gmail message (given a `messageId`) and returns a `BlobHandle` — a drop-in
alternative to the existing `drive.download_file` node. The downstream chain
(`document.extract_text → resume.parse_fields`) is unchanged because the
contract boundary (`BlobHandle`) is identical.

Drive is **kept**; Gmail is added alongside it. Both source chains continue to work.

## Decisions (from brainstorming)

- **Source = attachment**, not email body. The resume is a file (PDF/DOCX)
  attached to the message. Node returns a `BlobHandle`.
- **Attachment selection = first resume-like attachment.** The node scans the
  message parts and picks the first whose filename/MIME indicates PDF or DOCX.
  Trigger input is just `{ messageId }` — no `attachmentId` required.
- **Server-side REST, not the harness MCP tools.** The node follows the existing
  `drive.download_file` pattern: a capability handle (`ctx.gmail`) backed by an
  adapter that calls the Gmail REST API directly with a Bearer access token. The
  agent-facing Gmail MCP tools are not used (they require interactive auth and
  run outside the Next.js server).

## Architecture

The Gmail path mirrors the Drive path layer-for-layer:

| Layer       | Drive (existing)                         | Gmail (new)                                       |
|-------------|------------------------------------------|---------------------------------------------------|
| Contract    | `IDriveCapability.download(fileId)`      | `IGmailCapability.fetchAttachment(messageId)`     |
| Node        | `nodes/tools/drive.download_file.ts`     | `nodes/tools/gmail.fetch_attachment.ts`           |
| Adapter     | `infra/drive/GoogleDriveCapability.ts`   | `infra/gmail/GmailCapability.ts`                  |
| RunContext  | `ctx.drive`                              | `ctx.gmail`                                        |
| Env / token | `GOOGLE_ACCESS_TOKEN` (drive.readonly)   | `GMAIL_ACCESS_TOKEN` (gmail.readonly)             |

Adheres to the same architectural decisions in `ARCHITECTURE.md`:
- **D1/D2** — `gmail.fetch_attachment` is a `tool` node (deterministic I/O, no LLM).
- **D6** — bytes go to Supabase Storage; only a `BlobHandle` flows through the pipeline.
- **D7** — node receives the `ctx.gmail` capability handle, never the raw access token.
- **D9** — typed `StepResult`; expected failures surface as typed errors, not raw throws.

## Components

### 1. `IGmailCapability` (contract — `contracts/IRunContext.ts`)

```typescript
export interface IGmailCapability {
  /**
   * Fetch the first resume-like (PDF/DOCX) attachment from a Gmail message
   * and store it in Storage. Returns a BlobHandle; never returns raw bytes.
   */
  fetchAttachment(messageId: string): Promise<BlobHandle>;
}
```

Added to `IRunContext`:
```typescript
export interface IRunContext {
  // ...existing...
  readonly gmail: IGmailCapability;
}
```

### 2. `GmailCapability` (adapter — `infra/gmail/GmailCapability.ts`)

Extends the shared `GoogleApiCapability` base (`infra/google/`), which provides
retry/backoff, auth fetch, size guard, `ChainError`, Storage upload, sha256 —
the same base `GoogleDriveCapability` uses.

Constructor options (`GoogleApiCapabilityOptions`):
```typescript
export interface GoogleApiCapabilityOptions {
  accessToken: string;
  storage: IStorage;
  maxSizeBytes?: number | undefined;
}
```

`fetchAttachment(messageId)` flow:
1. `GET https://gmail.googleapis.com/gmail/v1/users/me/messages/{messageId}?format=full`
   → message with a `payload` tree.
2. Walk `payload.parts` (recursively, since parts can nest) and select the
   **first** part that is resume-like:
   - MIME `application/pdf`, or
   - MIME `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (DOCX), or
   - a `filename` ending in `.pdf` / `.docx` (case-insensitive) as a fallback.
   The selected part carries `body.attachmentId` and `mimeType`.
   If none found → throw `ChainError(..., "NO_RESUME_ATTACHMENT")`.
3. `GET .../messages/{messageId}/attachments/{attachmentId}` → JSON
   `{ size, data }` where `data` is **base64url**. Decode to a Buffer
   (`Buffer.from(data, "base64url")`).
4. Enforce `maxSizeBytes` (reuse 20 MB default + `FILE_TOO_LARGE` ChainError).
5. Compute sha256, upload to Storage (`pipeline-blobs`), return
   `{ storageRef, mime, size, sha256 }`.

The effective `mime` is the selected part's `mimeType`; when absent, derive from
the filename extension (`.pdf` → `application/pdf`,
`.docx` → the DOCX mime) so `document.extract_text`'s `mimeCategory` routing works.

Non-2xx responses → `ChainError(..., "GMAIL_API_ERROR")`. Raw response bodies are
redacted at the persistence boundary (`toSafeError`, D8) — same as Drive.

### 3. `gmail.fetch_attachment` node (`nodes/tools/gmail.fetch_attachment.ts`)

```typescript
const InputSchema = z.object({ messageId: z.string().min(1) });

export class GmailFetchAttachmentNode extends BaseNode<Input, BlobHandle> {
  readonly id = "gmail.fetch_attachment";
  readonly kind = "tool" as const;
  readonly inputSchema = InputSchema;
  readonly outputSchema = BlobHandleSchema;
  readonly description =
    "Fetch the first resume-like (PDF/DOCX) attachment from a Gmail message; returns a BlobHandle.";

  protected override async run(input, ctx): Promise<BlobHandle> {
    ctx.logger.info("Fetching Gmail attachment", { messageId: input.messageId });
    return ctx.gmail.fetchAttachment(input.messageId);
  }
}
```

Registered in `nodes/index.ts` via `registry.register(gmailFetchAttachmentNode)`.

### 4. Wiring (`di/buildEngine.ts`)

- Add `gmailAccessToken: string` to `BuildEngineOptions`.
- Construct `new GmailCapability({ accessToken: opts.gmailAccessToken, storage })`.
- Add `gmail` to the `ctxFactory`-built `IRunContext`.
- `apps/web` reads `GMAIL_ACCESS_TOKEN` and passes it through (alongside the
  existing `googleAccessToken`).

### 5. Chain wiring (fixture)

A Gmail-variant chain fixture (`fixtures/resume-chain-gmail.json`) swaps `s1`:

```json
{
  "stepId": "s1",
  "nodeId": "gmail.fetch_attachment",
  "inputMapping": { "messageId": { "from": "trigger", "path": "messageId" } }
}
```

`s2` (`document.extract_text`) and `s3` (`resume.parse_fields`) are copied
verbatim from `fixtures/resume-chain.json` — they consume the `BlobHandle` and
`{ text }` exactly as before. Trigger payload becomes `{ messageId }`.

## Error Handling

| Code                    | When                                            | Surfaced as          |
|-------------------------|-------------------------------------------------|----------------------|
| `NO_RESUME_ATTACHMENT`  | No PDF/DOCX part on the message                 | `ChainError` → typed StepResult |
| `FILE_TOO_LARGE`        | Decoded attachment exceeds `maxSizeBytes`       | `ChainError`         |
| `GMAIL_API_ERROR`       | Non-2xx from the Gmail REST API                 | `ChainError`, body redacted (D8) |

Transient network/5xx failures are retried with backoff (reused from the Drive
adapter pattern: 3 attempts, 500ms base, exponential).

## Testing (TDD — Red → Green → Refactor)

Written before implementation, matching the existing node/adapter test style.

1. **Node test** (`__tests__/nodes/gmail.fetch_attachment.test.ts`):
   - Valid `{ messageId }` → calls `ctx.gmail.fetchAttachment` and passes the
     `BlobHandle` through as `Ok`.
   - Missing/empty `messageId` → `InputInvalid`.
2. **Adapter test** (`__tests__/infra/GmailCapability.test.ts`, mock `fetch`):
   - Picks the first PDF/DOCX part out of a multi-part payload (and skips inline
     images / non-document parts).
   - Recurses into nested `parts`.
   - Decodes base64url attachment data correctly; uploads to Storage; returns a
     correct `BlobHandle` (mime/size/sha256).
   - No resume-like part → throws `NO_RESUME_ATTACHMENT`.
   - Oversized attachment → throws `FILE_TOO_LARGE`.
   - Non-2xx → throws `GMAIL_API_ERROR`.

## Scope (YAGNI)

**In scope:** the contract, adapter, node, wiring, the Gmail-variant fixture, and
the tests above.

**Out of scope:** email-body extraction; explicit `attachmentId` selection;
listing attachments; multiple-attachment disambiguation beyond "first
resume-like"; a UI toggle between Drive and Gmail sources (the existing trigger
form change, if any, is a thin follow-up — the engine/chain work is the
deliverable here).

## Verification

- `pnpm --filter @tool-chain/core build` then `pnpm -r typecheck` → clean (strict).
- `pnpm -r test` → new node + adapter tests green; existing tests unaffected.
- Manual: set `GMAIL_ACCESS_TOKEN` (scope `gmail.readonly`), insert the Gmail
  chain row, run with a real `messageId` that has a resume attachment; confirm
  streamed `ResumeDTO` and that `step_runs` holds a blob handle (not bytes) with
  no secrets in `error`.
