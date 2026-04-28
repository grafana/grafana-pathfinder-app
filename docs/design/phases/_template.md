# P*N* — _phase title_

> Implementation plan for phase _N_ of [Pathfinder AI authoring](../PATHFINDER-AI-AUTHORING.md).
> Phase entry and exit criteria: [AI authoring implementation index — P*N*](../AI-AUTHORING-IMPLEMENTATION.md).
> Tracking issue: _link to GitHub epic/issue_.

**Status:** Not started | In progress | Complete
**Started:** _YYYY-MM-DD_
**Completed:** _YYYY-MM-DD_

---

## Preconditions

_Filled at draft. What must be true on arrival._

**Prior-phase exit criteria to re-verify before starting:**

- [ ] _e.g., bundled CLI binary present at `<plugin-dir>/cli/pathfinder-cli` on all three target platforms_
- [ ] _e.g., `npm run check` clean on `main`_

**Surface area this phase touches:**

- _Files and directories — list the concrete paths the plan expects to create or modify._
- _Public APIs / exported symbols — what other code reads or imports from this surface today._
- _External contracts — schemas, MCP tool shapes, CLI flag surface, build-pipeline outputs._

**Open questions to resolve during execution:**

- _Anything the design leaves explicitly open that this phase must close._

---

## Tasks

_Filled at draft, checked off during execution. Atomic-commit-sized. Reference phase ID in commit messages (`P_N_: ...`).\_

- [ ] **1.** _Task description, with file paths._
- [ ] **2.** _..._
- [ ] **3.** _..._

### Test plan

- _Unit tests added or updated._
- _Integration tests._
- _Manual verification steps._
- _Commands the reviewer can run to confirm: `npm run check`, `npm run test:ci`, `mage test`, etc._

### Verification (matches index exit criteria)

- [ ] _Restate each exit criterion from the index entry as a checkbox; check at exit._

---

## Decision log

_Appended during execution. Each entry: date, decision, alternatives considered, rationale. May be empty if the phase ran without notable choices._

### _YYYY-MM-DD_ — _short title_

- **Decision:** _what was chosen._
- **Alternatives considered:** _what was rejected, briefly._
- **Rationale:** _why._
- **Touches:** _files / sections / contracts affected._

---

## Deviations

_Appended during execution. Departures from the design or this plan, with reason. May be empty._

### _YYYY-MM-DD_ — _short title_

- **What was planned:** _quote or paraphrase the original intent._
- **What changed:** _the deviation._
- **Reason:** _why the deviation was necessary._
- **Propagation:** _design docs / index / cross-cutting concerns that need updating, with status (done | followup-issue#NNN | not needed)._

---

## Handoff to next phase

_Mandatory at exit. 5–10 bullets. The only section the next phase's agent strictly needs to read._

- _What is now true that wasn't before — the new capability or surface delivered._
- _Gotchas the next agent should know about (non-obvious behavior, partial test coverage, known-flaky paths)._
- _Reusable fixtures, helpers, or test infrastructure introduced._
- _Deferred punts — what was scoped out and where it's tracked (issue link, P5 entry, follow-up note)._
- _Design docs or the index that no longer accurately reflect reality, with status (updated in this PR | follow-up issue | flagged for next phase)._
- _Specific functions/files the next phase will be touching that warrant a heads-up (e.g., "watch out for X — it has an implicit assumption about Y")._
