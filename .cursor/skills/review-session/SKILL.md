---
name: review-session
description: 'Experimental controller-backed PR review for grafana-pathfinder-app. Use only when the user explicitly asks for `/review-session`. `/review` stays the default and authoritative PR review.'
---

# Experimental review session

You are the supervisor. The controller at `.cursor/skills/review/scripts/session/session.mjs` owns the session state, the gates, the planner, the policy, verification batching, reconciliation, the ledger, and the report. You dispatch the tasks it gives you and record what comes back. You never decide a disposition, a count, a worker plan, or whether a gate applies.

This entry point is an experiment. `/review` remains the production review. Do not publish a session review, approve a PR, file an issue, or change the reviewed branch unless the user explicitly says so after seeing the rendered output.

## Host requirements

This bridge supports Claude Code with the Agent, Bash, Read, and Write tools. If the Agent tool is missing, record each agent task as blocked (see Dispatch). The session then renders an incomplete review. Never do an agent task yourself in its place.

## Start

1. Make an isolated worktree at the PR head and symlink `node_modules` from the main checkout. Commands run there.
2. Read the head SHA and the base. The base is `git merge-base origin/main <head>`. Write the PR title and description, unedited, to an intent file outside the repository: `{ "title": "<pr title>", "body": "<pr description>" }`. Add `"evidence_cutoff": "<ISO date>"` only when the user names one.
3. For a re-review, find the latest review by this same reviewer. Save its body to a file. Count all prior review submissions.
4. Start, with a sessions directory outside the repository (for example, your scratchpad):

```bash
node .cursor/skills/review/scripts/session/session.mjs start --repo <owner/name> --pr <n> --base <base-sha> --head <head-sha> --reviewer <your-login> --intent-file <abs-intent-file> --repo-dir <abs-worktree> --sessions-dir <abs-dir> [--prior-review <body-file> --prior-review-author <login> --prior-review-count <n>]
```

The controller decides full or incremental mode and the round. It falls back to a full review when the prior state is invalid, truncated, from another reviewer, or not an ancestor of the head. Running `start` again with the same inputs resumes the same session.

## Dispatch

Every command prints JSON with `ready` tasks, `obligations`, and `capability_limits`. Repeat until `ready` is empty:

- `executor: controller`: run `exec --session <dir> --all-ready`. Never run these commands yourself.
- `executor: root`: you do this task. Read its `brief`, write the JSON result to its `result` path, and run its `record` command.
- `executor: agent`: start a new Agent for each task with the prompt `Read <brief> and follow it exactly.` Dispatch independent ready tasks concurrently. Give each skeptic task its own Agent; never reuse an agent across independent skeptic roles. When the agent finishes, run the task's `record` command with `--agent-id` set to the agent ID from the Agent tool result. If the result shows no agent ID, pass `--no-agent-identity` instead.

If `record` rejects a result, send the error to the same agent and ask it to correct its result file. Do not edit an agent's result yourself. If a task cannot run, record it with `--blocked "<reason>"`.

A stage may be skipped only on the user's explicit instruction. Record it with `waive --session <dir> --stage <stage> --reason "<reason>" --consent "<the user's words>"`. A worker can never grant a waiver.

## Finish

Run `finalize --session <dir>`. Show the user the contents of `rendered_path` verbatim. If `complete` is false, the output is an incomplete review; list the open obligations.

Use `status --session <dir>` to inspect a session and `next --session <dir>` to resume one after an interruption. A new PR head needs a new session.

Lifecycle, evidence accounting, the evaluation kit, and known limits are in `docs/developer/REVIEW_SESSION.md`.
