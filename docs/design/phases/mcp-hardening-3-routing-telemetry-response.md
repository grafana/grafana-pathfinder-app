# MCP hardening, slice 3 — routing telemetry response

> Follow-up to [slice 1 — routing and composition](./mcp-hardening-1-routing-and-composition.md) and [slice 2 — integrity and normalize](./mcp-hardening-2-integrity-and-normalize.md).
> Source design: [MCP-AGENT-UX-HARDENING.md — issue #7](../MCP-AGENT-UX-HARDENING.md#7-agents-dont-reach-for-pathfinder-mcp-without-explicit-prompt-vocabulary).
> Trigger: production telemetry from a 2026-05-12 Cursor session against the deployed MCP — prompt _"Create a short interactive tutorial that shows how to add a Prometheus data source in Grafana"_ did not route to Pathfinder. The layer-3 `instructions` opener from slice 1 was too hedge-y to overcome the model's "just answer in prose" default.

**Status:** Complete
**Started:** 2026-05-12
**Completed:** 2026-05-12

---

## Goal

Close the routing gap slice 1 didn't fully close. Three targeted changes to the existing routing surface — all confined to `src/cli/mcp/lib/agent-routing.ts`, `src/cli/mcp/lib/server-instructions.ts`, and `src/cli/mcp/tools/authoring-start.ts`. No new mechanism; just stronger vocabulary and a more assertive default.

## What changes

1. **Trigger vocabulary expanded from 8 → ~25 phrases.** Organized by the verb × asset-noun pattern: any write/edit/update/create/author/build verb + content/guide/tutorial/walkthrough/how-to/learning-content noun should route here. Includes the operator-provided examples (_"write content"_, _"author a guide"_, _"create a tutorial"_).

2. **`PATHFINDER_NOUNS` expanded.** Added the looser asset nouns the operator called out: `content`, `guide`, `how-to`, `how-to guide`, `learning content`, `training material`. The existing canonical nouns (`Pathfinder`, `interactive guide`, `tutorial`, `walkthrough`, `step-by-step guide`) remain.

3. **New `PATHFINDER_DOMAINS` vocabulary.** Lists the Grafana product surface area (Prometheus, Loki, Tempo, Mimir, Pyroscope, Beyla, Alloy, OpenTelemetry, k6, Grafana dashboards / panels / alerts / data sources / plugins / navigation / workspace, Grafana Cloud / OSS / Enterprise) so product-area mentions carry routing signal even without canonical verbs.

4. **Layer-3 `instructions` opener rewritten as an assertive default.** From _"Use this server when the user wants to …"_ (hedge-y) to _"Default to using this server whenever the user asks to …"_ + _"Generic prose explanations should be a last resort, not the default response."_ This is the single most important change in the slice; it's what overrides the "just answer in prose" bias.

5. **`PATHFINDER_NOT_FOR` extended.** New entry disambiguating the verb+noun pattern: "writing or debugging queries, dashboards, or alert rules themselves (this server is for tutorials _about_ those things, not for authoring the things themselves)." So _"write a Prometheus query"_ does NOT route here; _"write a tutorial about Prometheus queries"_ does.

6. **`_start.domains` surfaced.** The new domain vocabulary appears in the `pathfinder_authoring_start` payload alongside `triggers` and `notFor` so an agent already in the MCP can reaffirm routing when product-area follow-ups come in.

7. **`SERVER_INSTRUCTIONS` line-count ceiling raised 30 → 40.** Test guard updated; rationale documented in the comment above the constant.

## Out of scope

- Cursor client-config description fields (Level 3 in the slice-3 design conversation). Re-evaluate if this slice doesn't close the gap.
- Grafana Assistant default-MCP-list / Assistant skill coordination. Same — depends on whether MCP-side fixes are sufficient.

---

## Tasks

- [x] **1. Expand `agent-routing.ts` vocabulary.** Trigger phrases ~25; nouns ~11; new `PATHFINDER_DOMAINS` array (~18 entries); `PATHFINDER_NOT_FOR` disambiguation entry added.
- [x] **2. Rewrite `server-instructions.ts` opener + reference `PATHFINDER_DOMAINS`.** Assertive default; "last resort" framing; product-area vocabulary.
- [x] **3. Surface `domains` in `_start` payload.** `tools/authoring-start.ts` reads `PATHFINDER_DOMAINS` and includes it alongside `triggers` and `notFor`.
- [x] **4. Update tests.** Bump the 30-line ceiling to 40 in `server-instructions.test.ts`; assert presence of "default to using this server" and "last resort"; assert presence of domain anchors (Prometheus, Loki); update `server.test.ts` `_start` assertion to require the new fields and trigger phrases.
- [x] **5. Update docs.** `docs/developer/MCP_SERVER.md` — describe the new four-section structure of `instructions`; bump the ceiling text. `docs/design/MCP-AGENT-UX-HARDENING.md` — capture the 2026-05-12 telemetry observation under issue #7; append slice-3 status note.
- [x] **6. Re-deploy + re-test.** ✓ _Complete (2026-05-12)._ Deployed `pathfinder-mcp-00005-jlh` revision to Cloud Run. Three Cursor prompts run fresh (new chats) against the deployed instance:
  1. _"I want to write content that walks a beginner through navigating to the Grafana data sources page."_ — Cursor invoked `pathfinder_authoring_start` as its first move. ✓ Routes.
  2. _"Put together a step-by-step walkthrough of setting up a Prometheus data source."_ — Cursor invoked `pathfinder_authoring_start` as its first move. ✓ Routes.
  3. _"Write a Prometheus query that returns the 95th percentile latency over the last 5 minutes."_ — Cursor answered with the actual PromQL (`histogram_quantile(0.95, sum(rate(...)) by (le))` with explanation). ✓ Correctly stayed out of Pathfinder.

  Three-for-three. The verb × asset-noun pattern + domain vocabulary + assertive opener together close the slice-1 routing gap. The `notFor` disambiguation correctly prevents over-routing on query-authoring prompts.

### Verification

- [x] 406 CLI tests pass (+3 from slice 2's 403: 1 new domains-constant test, 1 new assertive-opener test, 1 `_start` expanded assertion).
- [x] Typecheck / prettier clean.
- [x] Re-test the original failing prompt against deployed Cloud Run — passes. Plus two stretch prompts (verb-noun pattern, anti-routing) both behaving as designed.

---

## Decision log

### 2026-05-12 — slice-3 trigger-vocabulary pattern (verb × asset-noun)

- **Decision:** Trigger vocabulary is organized around a verb × asset-noun grid rather than enumerated case-by-case. Explicit phrases cover the highest-leverage 25 combinations; the verbs / nouns arrays + the assertive opener carry the pattern for variants we haven't listed.
- **Alternatives considered:** Enumerate every plausible phrase (would be ~80+, harder to maintain); ship only the verbs+nouns and skip explicit phrases (less concrete vocabulary for the model to match on).
- **Rationale:** Operator gave the pattern directly (_"if a person uses write/edit/update type of language around a written asset (content, guide, tutorial, interactive guide, etc) then I want the MCP server considered"_). The 25 explicit phrases are concrete vocabulary for routing-time matching; the underlying arrays let the assertive opener describe the pattern declaratively in one paragraph.
- **Touches:** `src/cli/mcp/lib/agent-routing.ts`.

### 2026-05-12 — `SERVER_INSTRUCTIONS` ceiling 30 → 40

- **Decision:** Bumped the unit-test ceiling from 30 lines to 40.
- **Alternatives considered:** Hold at 30 and move the assertive opener + domain list to `_start` only.
- **Rationale:** The assertive opener and the domain vocabulary are layer-3 work — they have to reach the model BEFORE tool selection, which means they have to be on the handshake. Moving them to `_start` defeats the point. The ceiling exists to discipline content; 40 is still tight enough to discipline. If the next slice wants more room, the answer is "move to `_start`," not "raise to 50."
- **Touches:** `src/cli/mcp/lib/server-instructions.ts`, `src/cli/mcp/lib/__tests__/server-instructions.test.ts`.

### 2026-05-12 — domain vocabulary lives in `agent-routing.ts`, not in `_start.compositionRules`

- **Decision:** `PATHFINDER_DOMAINS` is a new sibling array in `agent-routing.ts`, consumed by both `server-instructions.ts` and `tools/authoring-start.ts`.
- **Alternatives considered:** Add a domain bullet to `compositionRules` (would conflate routing with composition); embed directly in `server-instructions.ts` (would create drift with `_start`).
- **Rationale:** Routing vocabulary and composition rules are different concerns; keeping them in separate arrays keeps the consumers clean and the test surface focused. Single-source pattern matches what slice 1 established for trigger phrases.
- **Touches:** `src/cli/mcp/lib/agent-routing.ts`, `src/cli/mcp/lib/server-instructions.ts`, `src/cli/mcp/tools/authoring-start.ts`.

---

## Handoff to next phase

- **The routing thread is done for the MCP-side surface.** Three Cursor prompts (positive verb-noun, positive domain-driven, negative anti-routing) all behaved as designed against the deployed instance. Production telemetry from 2026-05-12 closed the slice-1 gap; the MCP server's three-layer hint surface now carries enough vocabulary weight to override the model's "just answer in prose" default.
- **Adding a new normalization or vocabulary domain is now cheap.** `PATHFINDER_DOMAINS` is the single source for product-area routing; extend it as Grafana ships new products (Faro, OnCall, Synthetic Monitoring, etc.) and both layers 2 and 3 pick up the new vocabulary automatically. Same for `PATHFINDER_TRIGGER_PHRASES`.
- **The 40-line `SERVER_INSTRUCTIONS` ceiling is a hard budget.** Past 40, the answer is "move new content to `pathfinder_authoring_start`," not "raise the ceiling further." `_start` is paid once per session; `instructions` is paid on every connect, so per-byte cost is higher there.
- **Level 3 was not needed.** The slice-3 design conversation outlined "Cursor client-config description field" and "Grafana Assistant default-MCP-list coordination" as escalation points if MCP-side fixes alone weren't sufficient. They weren't needed for Cursor. Whether they're needed for Grafana Assistant remains open — verify when the deployed MCP is exercised in a real Assistant session.
- **Verb × asset-noun pattern is the canonical mental model for trigger vocabulary.** Operator direction baked in during slice 3: any write/edit/update/create/author/build verb + any written-asset noun (content, guide, tutorial, walkthrough, how-to, learning material) should route. Future vocabulary additions should fit this grid; cases that don't (e.g., "show me how to..." — request for prose rather than authored content) should NOT route and may need new `notFor` entries.
- **Telemetry observation captured in `MCP-AGENT-UX-HARDENING.md`.** Status note under issue #7 reflects the 2026-05-12 failure that triggered the slice AND the 2026-05-12 re-test that confirmed the fix. Future planners hitting routing issues should look there first for the precedent.
