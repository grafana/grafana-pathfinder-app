# MCP hardening, slice 2 — artifact integrity + input normalization

> Hardening follow-up to [slice 1 — routing and composition](./mcp-hardening-1-routing-and-composition.md).
> Source design: [MCP-AGENT-UX-HARDENING.md](../MCP-AGENT-UX-HARDENING.md).
> Scope: issues **#1** (artifact corruption between calls) and **#2** (YouTube watch links rejected) + cross-cutting mechanism **M3** (CLI input normalization).
> Branch: `mcp-hardening-integrity-and-normalize`.
> Tracking issue: _to be filed_.

**Status:** Complete
**Started:** 2026-05-12
**Completed:** 2026-05-12

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

- [x] **5. `computeArtifactEtag` helper.** ✓ _Complete (2026-05-12)._ New `src/cli/utils/etag.ts` exports `computeArtifactEtag` (SHA-256 over canonical-form JSON of `{content, manifest}`, truncated to 16 hex chars / 64 bits), `splitArtifactEtag` (pulls `__etag` off the envelope and returns payload + tag), and `ARTIFACT_ETAG_FIELD` constant. Canonical form sorts keys at every depth; preserves array order (semantically meaningful for `blocks`). 12 unit tests in `etag.test.ts` cover determinism, key-order invariance, mutation detection, undefined manifest equivalence, array-reorder detection, and full round-trip / mismatch.
- [x] **6. Embed `__etag` on outgoing artifacts.** ✓ _Complete (2026-05-12)._ `outcomeResult` in `result.ts` now embeds `__etag` on the returned artifact envelope (sibling to `content` / `manifest`). Function comment documents the placement and the round-trip contract. Every tool that already returned an artifact (create, mutations, inspect, validate) inherits this automatically — no per-tool change.
- [x] **7. Verify `__etag` on mutation inputs.** ✓ _Complete (2026-05-12)._ `ArtifactInputSchema` accepts an optional `__etag: z.string().optional()`. New `verifyArtifactEtag` helper (top of `mutation-tools.ts`) recomputes the etag and compares; on mismatch returns `ARTIFACT_MUTATED` outcome (via `outcomeResult`) before any dispatch happens. Wired into all 6 mutation handlers (`add_block`, `add_step`, `add_choice`, `edit_block`, `remove_block`, `set_manifest`). Sharpened the `artifact` field `.describe()`: "Echo back verbatim including `__etag` … mismatch returns ARTIFACT_MUTATED before the schema validator runs."
- [x] **8. `state-bridge.ts` artifact-shape guard.** ✓ _Complete (2026-05-12) — no code change required._ The existing `asArtifact()` helper at `mutation-tools.ts` reads only `content` and `manifest`, so `__etag` is naturally stripped before reaching `withArtifact`. The CLI runner never sees the envelope field. No defensive change needed; documenting here for the audit trail.

### Cross-cutting + docs

- [x] **9. Extend the canonical-flow test.** ✓ _Complete (2026-05-12)._ Added four new assertions to `hardening-flow.test.ts` chained on the existing canonical flow: (a) `artifact.__etag` is non-empty 16-char hex on the first response; (b) etags across `created` / `markdownAdd` / `multistepAdd` / `stepAdd` are all distinct (state changes → hash changes); (c) a YouTube watch URL on `add_block(video)` produces `INPUT_NORMALIZED` + embed-URL persistence; (d) corrupting the artifact's `content.title` and re-passing produces an `ARTIFACT_MUTATED` error with remediation-shaped message. The composition guard is now end-to-end on slices 1+2.
- [x] **10. Docs update.** ✓ _Complete (2026-05-12)._ `docs/developer/MCP_SERVER.md` — added `INPUT_NORMALIZED` to the warnings code registry, added a new "Artifact integrity (`__etag`)" subsection under "Tool surface" covering the wire shape, the verification contract, and the `ARTIFACT_MUTATED` error response. `docs/design/MCP-AGENT-UX-HARDENING.md` — appended Status (2026-05-12) annotations to issues #1 and #2; added a status annotation to M3 documenting the slice-2 build; marked OQ1 resolved with a one-line answer pointing at the slice decision log; appended a slice-2 decision-log entry mirroring the slice-1 pattern.

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

### 2026-05-12 — OQ1: ETag visibility — visible `__etag` on the artifact envelope

- **Decision:** ETag lives at the artifact envelope (`artifact.__etag`), sibling to `content` and `manifest`. Computed by `outcomeResult` on the way out; verified by `verifyArtifactEtag` at the top of each mutation handler. SHA-256 truncated to 16 hex chars; canonical-form (sorted-key) JSON serialization.
- **Alternatives considered:** Invisible server-side plumbing (impossible under the stateless contract — there's no per-call server state to remember the previous hash). Hash inside `content` (pollutes the schema-validated shape). Hash on `manifest` (couples to a field that's sometimes absent).
- **Rationale:** The stateless contract forces the etag onto the wire so the agent can echo it back. Envelope-level placement keeps it out of the schema-validated content and gives a single `verifyArtifactEtag` entrypoint at the MCP layer. The `__etag` field name signals "internal — pass through unchanged" (double-underscore convention).
- **Touches:** `src/cli/utils/etag.ts` (new), `src/cli/mcp/tools/result.ts`, `src/cli/mcp/tools/mutation-tools.ts`.

### 2026-05-12 — `assertEmbeddableVideoUrl` left in place as defense-in-depth

- **Decision:** The CLI validator function `assertEmbeddableVideoUrl` keeps its watch / youtu.be error branches even though the normalizer ahead of it now makes them dead code for runner-mediated inputs.
- **Alternatives considered:** Simplify the validator down to "URL is http/https"; rely entirely on the normalizer.
- **Rationale:** The normalizer runs in `runAddBlock` and `runEditBlock`, but any future code path that bypasses those runners (validate-only flows, direct CLI invocations against a hand-edited content.json) would lose the safety net. Defense-in-depth costs nothing here — both branches stay, the normalizer just makes them rare.
- **Touches:** `src/cli/utils/cli-validators.ts` (unchanged).

### 2026-05-12 — Normalization warnings ride on idempotent no-ops too

- **Decision:** In `runAddBlock`, `INPUT_NORMALIZED` warnings are surfaced even when `--if-absent` skipped the append. Composition / selector warnings continue to fire only on actual append.
- **Alternatives considered:** Suppress all warnings on no-ops (symmetric with composition / selector logic).
- **Rationale:** The agent benefits from learning the canonical form regardless of whether the call ended up appending. A no-op shouldn't hide the fact that the input was non-canonical — the user might pass the same non-canonical form in a different call seconds later and trip the same round-trip if we suppress.
- **Touches:** `src/cli/commands/add-block.ts`.

---

## Deviations

_Empty at draft._

---

## Handoff to next phase

- **M3 is now the canonical place to add input normalizations.** Extend `normalizeBlockInput` in `src/cli/utils/input-normalizers.ts` with new block-type branches; the runner-side wiring in `runAddBlock` and `runEditBlock` already pulls warnings into the outcome. Candidate next normalizers: trailing slashes on URLs (any block with a URL field), whitespace trimming on titles/descriptions, slug-ification of package ids when an agent passes a human title verbatim to `pathfinder_create_package` without an explicit id.
- **`artifact.__etag` is now load-bearing.** Every response carrying an artifact embeds it (`outcomeResult` does this for all consumers). Every mutation verifies it (`verifyArtifactEtag` short-circuits each handler). When extending the mutation surface — adding a new mutation tool, accepting an artifact in a new tool — copy the `verifyArtifactEtag(artifact)` short-circuit at the top of the handler. `pathfinder_inspect` / `pathfinder_validate` intentionally don't verify (read-only, the bug class doesn't apply) but they do return etags via `outcomeResult` so the agent can continue the chain through them.
- **`__etag` never reaches the CLI runner.** `asArtifact()` in `mutation-tools.ts` projects to `{content, manifest}` only. If a future code path introduces a new way to dispatch from MCP → CLI, mirror the same projection so the envelope stays at the MCP layer.
- **`assertEmbeddableVideoUrl` is dead code for runner-mediated inputs but live for direct invocations.** Don't delete it; it's the defense-in-depth backstop. If you ever delete a normalizer, restore the corresponding validator branch first.
- **`INPUT_NORMALIZED` warnings ride on idempotent no-ops.** Documented in the slice decision log — opposite of how `MULTISTEP_COMPOSITION_HINT` and `UNVERIFIED_SELECTOR` behave (those gate on `appended`). The asymmetry is intentional; future warnings should pick a side and document it.
- **403 CLI tests pass.** The composition guard at `src/cli/mcp/__tests__/hardening-flow.test.ts` now covers slices 1+2 end-to-end. Drive that test if you change any hint surface, the etag, or the normalizer dispatch.
- **OQ2 (step / choice block ids) is the natural next conversation.** Slice 1 closed issue #3 (selectors) and slice 2 closed #1 + #2; the remaining high-value issue is #4, which needs a design call on whether step ids are required (forcing a content-version bump and migration) or auto-id on read (existing artifacts get ids minted on first load).
- **Hardening doc statuses updated.** Issues #1, #2 + M3 in `docs/design/MCP-AGENT-UX-HARDENING.md` now carry **Status (2026-05-12)** annotations. OQ1 marked resolved. Slice-2 entry appended to the decision log.
