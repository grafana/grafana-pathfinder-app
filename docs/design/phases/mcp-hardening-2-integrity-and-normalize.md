# MCP hardening, slice 2 — artifact integrity + input normalization

> Hardening follow-up to [slice 1 — routing and composition](./mcp-hardening-1-routing-and-composition.md).
> Source design: [MCP-AGENT-UX-HARDENING.md](../MCP-AGENT-UX-HARDENING.md).
> Scope: issues **#1** (artifact corruption between calls) and **#2** (YouTube watch links rejected) + cross-cutting mechanism **M3** (CLI input normalization).
> Branch: `mcp-hardening-integrity-and-normalize`.
> Tracking issue: _to be filed_.

**Status:** In progress
**Started:** 2026-05-12
**Completed:** _YYYY-MM-DD_

---

## Goal

Two narrow agent-UX wins that compose cleanly on slice 1's plumbing:

1. **Artifact integrity (#1).** Detect agent-corrupted artifacts before they reach the schema validator. Today an agent that subtly reformats a markdown block's `content` field between hops sees `SCHEMA_VALIDATION` and self-diagnoses as a schema misunderstanding rather than a round-trip discipline failure. After this slice, a corrupted artifact returns a dedicated `ARTIFACT_MUTATED` error with remediation-shaped text pinpointing the actual bug.
2. **Input normalization (#2).** When a field has a known canonical form, normalize in the CLI runner and emit a soft `INPUT_NORMALIZED` warning instead of failing. First consumer: YouTube watch / short / shorts URLs auto-converted to embed form. Builds **M3** as the third cross-cutting mechanism, reusable for future normalizations (trailing slashes, whitespace, slug-ification).

Slice 1 built M1 (three-layer hints) and M2 (`warnings[]`). This slice builds M3 (CLI-side input normalization) and uses M2 for warning emission + new error codes for the failure case.

**Out of scope (deferred to a later slice):**

- **M4 — selector catalog tool.** Still blocked on OQ3.
- **Issue #4 — step / choice block ids.** Schema-shape change; deserves its own design pass on OQ2 (next conversation).
- **Issue #5 — hop-over-hop growth.** Compression is cheap and could land any time; the handle/patch decision is tracked under P5 GCS-sessions.

---

## Preconditions

- [ ] `npm run check` clean on `main` (or on slice 1 branch tip if slice 1 hasn't merged yet).
- [ ] Slice 1 plumbing in place — `OutcomeWarning` type, `src/cli/utils/warnings.ts` module, `outcomeResult` passthrough.

**Surface area this phase touches:**

| File                                           | Change                                                                                                                                  |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `src/cli/utils/etag.ts`                        | **New.** `computeArtifactEtag({content, manifest})` returns a short deterministic hex digest. SHA-256 over canonical (sorted-key) JSON. |
| `src/cli/utils/warnings.ts`                    | Add `inputNormalizedWarning(field, from, to)` constructor + extend the registry comment.                                                |
| `src/cli/utils/input-normalizers.ts`           | **New.** `normalizeBlockInput(type, fields)` returns `{ normalized, warnings }`. First normalizer: YouTube URL forms on video.src.      |
| `src/cli/commands/add-block.ts`                | Call `normalizeBlockInput` before validation. Thread warnings into the outcome.                                                         |
| `src/cli/commands/edit-block.ts`               | Same.                                                                                                                                   |
| `src/cli/utils/cli-validators.ts`              | Drop the YouTube watch→embed remediation error path for video.src (replaced by normalization). Keep the malformed-URL error path.       |
| `src/cli/mcp/tools/result.ts`                  | `outcomeResult` embeds `__etag` on returned artifact when present.                                                                      |
| `src/cli/mcp/tools/mutation-tools.ts`          | Accept optional `__etag` in `ArtifactInputSchema`. Pre-dispatch ETag verification → `ARTIFACT_MUTATED` error. Sharpen `.describe()`.    |
| `src/cli/mcp/tools/state-bridge.ts`            | Strip `__etag` before writing to tmpdir so the CLI runner never sees it.                                                                |
| `src/cli/mcp/__tests__/server.test.ts`         | Update the existing YouTube test (now expects `status: ok` + `INPUT_NORMALIZED` warning instead of error).                              |
| `src/cli/mcp/__tests__/hardening-flow.test.ts` | Add an ETag round-trip assertion + a mutation-detection assertion + a YouTube-normalize assertion to the canonical flow.                |
| `docs/developer/MCP_SERVER.md`                 | Add new error code `ARTIFACT_MUTATED` to the response shape docs. Add `INPUT_NORMALIZED` warning to the registry. Brief `__etag` note.  |
| `docs/design/MCP-AGENT-UX-HARDENING.md`        | Append Status (2026-05-12) annotations to issues #1 and #2; mark OQ1 resolved; append decision-log entry for slice 2.                   |

**Public APIs that change:**

- MCP mutation tool responses now include an `artifact.__etag` field. Clients that pass `artifact` back unchanged (the documented contract) work automatically; clients that strip or reformat the artifact will trip the new check.
- New `ARTIFACT_MUTATED` error code on the response shape. Documented in MCP_SERVER.md.
- New `INPUT_NORMALIZED` warning code. The existing CLI behavior for YouTube watch URLs flips from error to ok+warning; one MCP-level test needs updating.

**Open questions to resolve during execution:**

- **OQ1 (ETag visibility — invisible plumbing vs. visible `__etag`):** Effectively forced by the stateless contract — invisible is impossible without server state. The agent must echo the etag back, which means the field must be on the wire. Decision proposed: client-visible `artifact.__etag` (sibling to `content` and `manifest`, not nested inside `content`). Document at task 5 land.

---

## Tasks

Atomic-commit-sized. Reference slice ID in commit messages (`MCP-HARDEN-2: ...`).

### M3 plumbing (issue #2 prerequisite)

- [x] **1+2. M3 plumbing and YouTube normalizer.** ✓ _Complete (2026-05-12, bundled — empty-stub task 1 + YouTube-implementation task 2 land together to avoid a wasted commit on a placeholder._ Added `inputNormalizedWarning(field, from, to)` to `src/cli/utils/warnings.ts` with registry comment update. New `src/cli/utils/input-normalizers.ts` exports `normalizeBlockInput(type, fields)` returning `{ normalized, warnings }`. The `video` branch handles `youtube.com/watch?v=ID`, `youtu.be/ID`, `youtube.com/shorts/ID`, plus tolerant variants (missing protocol, `m.youtube.com`). Already-embed URLs and non-YouTube URLs pass through with no warning. 14 unit tests in `src/cli/__tests__/input-normalizers.test.ts` cover the matrix.

### Issue #2 — YouTube auto-normalize

- [x] **3. Wire into runners.** ✓ _Complete (2026-05-12)._ `runAddBlock` and `runEditBlock` now call `normalizeBlockInput` after `parseOptionValues` and before `assertCliBlockFields`. Normalization warnings are prepended to the outcome `warnings[]` so they ride alongside composition / selector warnings. In `runAddBlock`, normalization warnings ride on every successful call (including idempotent `--if-absent` no-ops); composition / selector warnings continue to fire only on actual append.
- [x] **4. Update existing tests + sharpen schema description.** ✓ _Complete (2026-05-12)._ Updated 2 unit tests in `commands.test.ts` and 1 integration test in `server.test.ts` — they previously expected `status: error` with the watch→embed remediation message; they now expect `status: ok` with an `INPUT_NORMALIZED` warning, plus verification that the persisted block carries the embed URL. Sharpened the `JsonVideoBlockSchema.src` `.describe()` text to name the auto-conversion safety net. Left `assertEmbeddableVideoUrl` in `cli-validators.ts` untouched — the watch/youtu.be branches are dead code for normalized inputs but stand as a defense-in-depth backstop if a future code path bypasses the normalizer. 391 CLI tests pass.

### Issue #1 — Artifact integrity (ETag)

- [ ] **5. `computeArtifactEtag` helper.** New `src/cli/utils/etag.ts`. Deterministic short hex digest (first 16 hex chars of SHA-256) over canonical-JSON serialization of `{content, manifest}`. Exclude `__etag` itself from the hash input so a round-tripped artifact hashes to its original value. Unit tests: same input → same hash, sorted-key stability, exclusion of `__etag` from hash input, manifest-undefined handling.
- [ ] **6. Embed `__etag` on outgoing artifacts.** Update `outcomeResult` in `src/cli/mcp/tools/result.ts` to compute and embed `__etag` in the returned artifact when `artifact` is present. Document in the function comment that `__etag` lives at the envelope level (sibling to `content` / `manifest`), not inside the content shape.
- [ ] **7. Verify `__etag` on mutation inputs.** Modify `ArtifactInputSchema` in `mutation-tools.ts` to accept an optional `__etag: z.string().optional()`. In each mutation handler, if `__etag` is present, recompute the etag of `{content, manifest}` and compare. On mismatch, return an `ARTIFACT_MUTATED` error via `outcomeResult` _before_ dispatching to the CLI runner. Strip `__etag` before passing to `withArtifact` so the CLI runner never sees it (state-bridge must not write it to tmpdir). Sharpen the `artifact` field `.describe()`: "Echo the artifact object from the previous response verbatim, including `__etag`. Do not re-serialize, reformat, re-key, or 'fix' any field — even fields that look wrong are valid CLI output."
- [ ] **8. `state-bridge.ts` artifact-shape guard.** Make sure `withArtifact` ignores any unknown top-level keys on the incoming artifact wrapper (notably `__etag`). The CLI's `runX` functions take `{content, manifest}` only; the wrapper has no business reaching them.

### Cross-cutting + docs

- [ ] **9. Extend the canonical-flow test.** In `hardening-flow.test.ts`: (a) after each mutation, assert `artifact.__etag` is a non-empty string and changes across mutations; (b) pass the artifact unchanged on subsequent calls — confirm no `ARTIFACT_MUTATED` error; (c) add a corruption test that mutates `artifact.content.blocks[0].content` (a string field) and confirms `ARTIFACT_MUTATED` on the next mutation; (d) add a YouTube watch-URL add — confirm `status: ok` + `INPUT_NORMALIZED` warning + the artifact's video.src is the embed form.
- [ ] **10. Docs update.** `docs/developer/MCP_SERVER.md` — add `__etag` to the response shape section, add `ARTIFACT_MUTATED` to a new "Error codes" subsection (or extend the warnings table), add `INPUT_NORMALIZED` to the warnings registry. `docs/design/MCP-AGENT-UX-HARDENING.md` — append Status (2026-05-12) to issues #1 and #2; mark OQ1 resolved; append slice-2 decision-log entry.

### Test plan

- **Unit:** `computeArtifactEtag` determinism; `normalizeBlockInput.video` cases (watch / youtu.be / shorts / embed-noop / non-YouTube-passthrough); `inputNormalizedWarning` shape.
- **Integration:** `runAddBlock` + `runEditBlock` with a YouTube watch URL — outcome.status=ok, warnings carries INPUT_NORMALIZED, written artifact has embed URL. MCP `pathfinder_add_block` flow with corrupted artifact — outcome.code=ARTIFACT_MUTATED.
- **Manual:** Drive MCP Inspector — author a guide, copy the artifact, hand-edit a field, paste back, confirm `ARTIFACT_MUTATED`.
- **Reviewer commands:** `npm run check`, `npm run test:ci`.

### Verification (restate as checkboxes)

- [ ] Mutation tool responses include `artifact.__etag` (non-empty hex).
- [ ] Passing the artifact back unchanged (including `__etag`) succeeds; the new response has a different `__etag` reflecting the new state.
- [ ] Modifying any field in the artifact (other than re-running through the server) and re-passing returns `ARTIFACT_MUTATED` error.
- [ ] `pathfinder_add_block --type video --src https://www.youtube.com/watch?v=ID` returns `status: ok` with an `INPUT_NORMALIZED` warning naming the from→to conversion.
- [ ] Malformed / non-YouTube video URLs still return `INVALID_VIDEO_URL` error.
- [ ] `npm run check` clean.

---

## Decision log

### Proposed at draft — to confirm or revise when their task lands

- **OQ1 — ETag visibility (invisible plumbing vs. visible `__etag`):** Decision proposed — **visible `__etag` on the artifact envelope (sibling to `content` / `manifest`)**. Rationale: invisible plumbing is impossible under the stateless contract (no per-call server state to remember the previous hash). The agent must echo the etag back, which means it must be on the wire. Naming follows the `__etag` proposal in the hardening doc (double-underscore prefix signals "internal — pass through unchanged"). Confirm at task 5 / 6 land.

---

## Deviations

_Empty at draft._

---

## Handoff to next phase

_Fill at exit._
