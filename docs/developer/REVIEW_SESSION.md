# Experimental review-session controller

`/review-session` is an experimental, opt-in way to run the same PR review as `/review`. It changes who owns the orchestration and the evidence accounting. It does not change what is a blocker, the skeptic voting rules, the planner budgets, or the report format. `/review` remains the production review.

The skill is `.cursor/skills/review-session/SKILL.md`. The controller is `.cursor/skills/review/scripts/session/session.mjs`.

## What the controller owns

The supervisor (the agent that runs the skill) dispatches tasks and records results. The controller does everything that decides scope or outcome:

- It runs `security-gate.mjs` on the review range and `contract-evolution-gate.mjs` for each routed subsystem or cross-cutting concern.
- It runs the planner on the routed concerns and makes one task for each planned worker, for root overflow, and for root synthesis.
- It runs every evidence command itself: checks, test-efficacy reverts, probes, and baseline re-runs.
- It feeds every observation through `review-policy.mjs`, creates exactly the skeptic batches the facade asks for, and runs reconciliation.
- It derives the stage ledger and the author-facing findings from these records, and renders them with `review-report.mjs`.

No task result can carry a worker count, a security-trigger flag, a ledger count, a disposition, or a waiver. The result validators reject unknown fields.

## Session lifecycle

`start` derives the session identity from the repository, PR, base and head SHAs, reviewer, PR intent, mode, round, prior-state provenance, and the hashes of the shared review assets. The same inputs give the same session ID, so `start` again resumes. A new head is a new session.

State is an append-only, hash-chained event log (`events.jsonl`) in the session directory. `session.json` is a snapshot that is rebuilt from the log after every write. One supervisor writes at a time: a writer lock refuses a second live writer, and every append checks the revision it read. A torn trailing write is ignored on read and repaired on the next append. If any shared review asset changes during a session, the controller refuses further writes.

`--intent-file` holds the PR title, the unedited description, and an optional evidence cutoff. The route, observer, specialist, and synthesis inputs carry it as `pr_intent`, marked as untrusted evidence. When a contract-evolution gate fires, the contract brief asks whether the description says the change follows, extends, or replaces the established contract, as `/review` does. A missing statement or stale anchor is a documentation-drift canonical observation (kind defect, impact none). Observers carry the `/review` supplemental documentation-drift rule word for word: only when changed subsystems, scripts, skills, routes, flags, or architecture can stale agent guidance. It goes through the same policy as every other observation.

Observer, security-specialist, and root-overflow inputs do not inline the owned diff. The controller writes it as per-file shards under the task's `diff/` directory, each at most 20,000 characters (a larger file's diff is split into numbered parts). `input.json` carries `diff_manifest`, one `{ path, shard, characters, changed_functions }` entry per shard. Shard names are built from a sanitized form of the path, so a contributor-controlled filename cannot place a shard outside the task directory.

When a prior review is supplied, the controller saves its exact body as a content-addressed session artifact. The prior-check and synthesis inputs carry each prior finding's original title, problem, and requested action from that artifact, so a fresh supervisor verifies the original objection rather than one rebuilt from an ID. The body is evidence, not instructions. A missing or altered artifact stops the session.

If a prior blocker was not verified fixed but the shared policy now disposes it as something other than blocking, `status` lists it under `convergence`. This is a flag for the reader, not a new rule. The shared policy still decides the disposition from the restated facts.

`record` keeps the submitted result file byte for byte as a content-addressed artifact and puts its `ref`, `sha256`, and submitted path in the event (`raw_result`). The validated, normalized form is the event's `result`, with its own `result_hash`. A rejected result is kept the same way, in a `result_rejected` event with the validator error. `record` then exits 2 and prints a ready `correction` that quotes the error verbatim and names a new version path (`result.v2.json`, then `.v3.json`); a correction never overwrites an earlier version. Anything the supervisor adds beyond that correction is coaching, recorded first with `coach` as a `coaching_recorded` event that holds the exact text. `status` lists coaching events and checks every recorded raw artifact against its hash; `finalize` refuses a session whose raw artifacts were altered or removed.

Skeptic input is built from an allowlist of claim fields (`CLAIM_FIELDS` in `skeptic-claim.mjs`): finding and concern IDs, kind, title, evidence, why it matters, files, origin, impact, reversibility, scope effect, `breaks_shipped_path`, and `induced`. Severity, confidence, suggested action, and timing are withheld. Which task and agent reported a finding, which refs synthesis merged into it, and revision reasons go into the skeptic task's `spec.provenance` in the event log, never into `input.json`. As defence in depth, `record` rejects a producer, prior-check, check-resolution, or synthesis observation whose claim text states something about the review rather than the code, such as reviewer counts, agreement, or a recommendation to block. That check is narrow. Schema validation cannot make arbitrary prose persuasion-proof; the allowlist and the separate provenance record are the primary control, and a post-run audit of what each skeptic saw remains necessary.

The contract-specialist brief carries the full packet schema from `contract-evolution-policy.mjs`, every field, enum, and `sources` entry shape, with valid examples; `schema.json` holds a valid example packet.

Recording the same result twice is a no-op. A different result for a completed task needs `--revise <reason>`. It is accepted only for observer, specialist, root-overflow, and skeptic tasks, and only before anything downstream consumes the result. The superseded observations stay in the log.

The task graph, in order:

| Stage             | Task (executor)                                                  | Created when                                                  |
| ----------------- | ---------------------------------------------------------------- | ------------------------------------------------------------- |
| Verify prior      | `prior_check` (root)                                             | Incremental mode with prior blockers or deferred items        |
| Route             | `route` (root)                                                   | Start, or after the prior check                               |
| Contract scan     | `contract_scan` (root)                                           | A routed gate fired, or a gated concern has a contract anchor |
| Observe           | `observer`, `security_specialist`, `contract_specialist` (agent) | The planner returns its workers                               |
| Observe           | `root_overflow` (root)                                           | The planner leaves concerns with root                         |
| Evidence          | `evidence_plan` (root), then `command` tasks (controller)        | After routing                                                 |
| Resolve           | `check_resolution` (root), baseline `command` (controller)       | A check fails, or a probe contradicts its claim               |
| Synthesis         | `synthesis` (root)                                               | Every earlier task is completed or blocked                    |
| Verify            | `skeptic` batches (agent)                                        | The policy facade returns `needs_verification`                |
| Reconcile, render | controller only                                                  | Policy is final for every observation                         |

`start` also derives the changed surface with `changed-surface.mjs`: whether Go changed, and which dependency manifests changed. When Go changed, the evidence plan must include `go_build`, `go_lint`, and `go_test`; the controller fills in `go build ./...`, `npm run lint:go`, and `go test ./pkg/...` for any the plan omits, and rejects `not_applicable` for them. When a dependency manifest changed, the security specialist and the security observer are asked to audit only the added or changed packages and to date their advisory source; when the intent has an evidence cutoff, advisory data after it cannot support a finding. No audit runs otherwise.

Observer, contract-specialist, and skeptic briefs ask for evidence that fits the claim. A runtime-dependent or contested claim needs a focused test, a probe, or a mutant where feasible, with its argv and result. A statically demonstrable defect needs the file:line path from the entry point to the failure. Neither every regression nor every missing test needs a probe or a finding.

The route result must map every changed file to routed concerns or to an explicit gap. In a full review it must route every always-on concern. In an incremental review an always-on concern that is not routed needs a `concern_gaps` entry. When the security gate triggers, the controller marks the security specialist itself.

## Host integration

The first bridge is Claude Code. A Node CLI cannot start a host agent, so the supervisor reads `next`, starts one Agent for each agent task with the generated brief, and records the result with the Agent tool's agent ID. Root tasks are done by the supervisor. Controller tasks run with `exec`.

Each receipt has a provenance label:

- `controller_observed`: a command the controller ran itself.
- `host_reported`: an agent result with the host's agent ID, as reported by the supervisor.
- `unverified_identity`: an agent result recorded with `--no-agent-identity`. `status` lists this under `capability_limits`.
- `root_attested`: a task the supervisor did itself.

The controller rejects a skeptic result from an agent that has already given a verdict on the same finding. A receipt is not proof that an agent read a file or reasoned correctly. Structural completion and review accuracy are different guarantees.

If the host has no Agent tool, the supervisor records each agent task with `--blocked`. The session then renders the existing incomplete report.

## Evidence accounting

Commands are argument arrays. The first argument must be `npm`, `npx`, `node`, `go`, or `mage`; the controller never starts a shell. A check may have up to four runs, for example jest and `go test` under `unit_tests`. Checks run in the review checkout at the pinned head. Efficacy reverts, probes, and baseline runs each run in a disposable worktree, which the controller then removes. A worktree it cannot remove is an open obligation.

Every failed check and every contradicted probe needs a resolution:

- `observation`: the failure is caused by the PR and goes through the policy facade like any other finding.
- `baseline_failure`: the claim names a `signature`, a literal line from the head failure output such as the failing test name. It may list changed test files or fixtures in `preserve_paths`, with a `preserve_reason`; implementation files are never copied, so the base keeps its own implementation. The controller runs the same command at base and accepts the claim only if the base fails with the same failure kind and the signature appears on a failing-result line (a failing test, or an error line for a setup failure) in both outputs. A passing base, a base that fails a different test, a missing test, a build failure against a head assertion failure, or an unclassified failure leaves the check unresolved.
- `claim_refuted` (probes only): the probe disproved the worker's claim, and synthesis sees it.
- `environment`: the review is incomplete.

The controller classifies each efficacy revert from its captured output, and the ledger records the class with a one-line `evidence` signature:

- `inconclusive_setup`: a setup, import, module-resolution, or compile failure, such as jest `Test suite failed to run`, `Cannot find module`, a TypeScript error, or a Go `[build failed]` or `file.go:line:col:` compile error. The test never exercised the behavior.
- `fails_on_behavior`: an assertion failed (`expect(...)`, `Expected:`/`Received:`, `AssertionError`, or a Go `--- FAIL` with a `_test.go:line:` assertion line).
- `inconclusive_error`: the test errored without an assertion failure, such as an uncaught `TypeError` or a Go panic, and any output that matches none of these.
- `passes_without_fix`: the run exited 0.

Setup signatures are checked first, so a run that both fails to compile and fails an assertion is inconclusive. Only `fails_on_behavior` counts as a test that detects the regression; `status` lists inconclusive runs under `evidence_quality`.

Root synthesis receives every `no_test_exists` and `passes_without_fix` entry as `efficacy_gaps` and must dispose each one in `efficacy_dispositions`, with the `finding_id` of an observation it keeps or adds, or a one-line reason it needs none. The controller rejects a synthesis result that leaves a gap undisposed or names a finding it does not keep. The ledger records the result as `disposition_note`.

These are reporting rules (the stage ledger in `docs/design/PR_REVIEW.md`), not disposition policy: the classes and notes change what the `Checks:` line claims, and no observation's disposition depends on them.

## Evaluation kit

`.cursor/skills/review/scripts/session/eval/eval.mjs` supports paired comparison of `/review` and `/review-session`:

- `validate --case <manifest> [--repo-dir <repo>]` checks a case manifest. It also checks that the SHAs exist, that the base is an ancestor of the head, and that the head is not newer than the evidence cutoff.
- `prepare --case <manifest> --repo-dir <repo> --out <dir>` builds a fresh checkout that holds only the pinned commits and their history. It has no refs and no commit after the cutoff.
- `capture --case <manifest> --arm review|review-session --run <n> --rendered <file> --meta <file> --out <runs-dir>` stores one append-only run record. It rejects a report whose PR, reviewed head, or round shape does not match the case. A report with no state marker, such as an incomplete review, is recorded as `unverified`. It counts toward the incomplete-run rate even when its rendered verdict looks complete, and it is never scored. Run meta states `subagent_tokens` and `root_tokens` separately; a run missing either is listed under `runs_missing_cost`.
- `mask --runs <dir> --seed <private> --out <blinded> --mapping <mapping>` writes the blinded findings for adjudicators. The arm-to-finding mapping goes to a separate file.
- `compare --runs <dir> --mapping <file> --adjudications <file> --keys <dir> --cases <dir>` reports blocker precision, known-defect and architectural recall, and incomplete-run rate with raw denominators. Recall is reported twice: detection, and detection with an acceptable disposition from the key. It also reports total cost and per-case verdicts. Unadjudicated cases are listed as excluded. A case whose arms differ in run count, model, reasoning setting, or tool revision is listed under `unpaired_cases` and left out of the comparison. Adjudication labels must be real booleans; duplicate, contradictory, or dangling labels stop the comparison. Convergence across rounds (reopened findings, new regressions, unnecessary new blockers, adjacent-work demands) is not scored yet, and the report says so.

The starter manifests in `eval/cases/` are all `unadjudicated` candidates. Answer keys never go in the repository; `eval/answer-key.template.json` shows their shape. Keep keys in a private directory that no reviewer context can reach. A maintainer adjudicates each blinded finding as real, PR-attributable, and necessary before merge. A newly found valid finding updates the key with a recorded revision, and both arms are scored against the updated key.

For the pilot, use 10 adjudicated cases with two fresh-context runs per arm. Use the same model, reasoning setting, tools, and shared review assets for both arms. Alternate the arm order. Do not give either arm the other arm's output.

## Known limits

- Routing judgment stays with the agent. The controller makes omissions visible (every changed file and every always-on concern is accounted for), but it cannot prove the router chose every relevant neighbour. Coverage is per file, not per hunk.
- The supervisor reports host agent IDs. The controller cannot verify them against the host's own metadata.
- A baseline match checks the failure kind and one failing-result line, not the whole failure. Two different failures of the same test can still match.
- Revert classification reads output signatures. A test runner with an unfamiliar output format is classified `inconclusive_error`, never as a behavioral failure.
- Evidence cutoffs use commit dates. A commit pushed after the cutoff with an older date passes the cutoff check.
- The meta-claim check on observation text matches known shapes of review talk. Prose that persuades without them passes, so audit skeptic inputs after a run.
- Optional findings from round 1 do not carry into an incremental round unless they were deferred. This is the existing state-marker behaviour, not a new rule.
