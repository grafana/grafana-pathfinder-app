# Operations after the guarded snapshot

Load this reference only after the snapshot reaches `ready_for_triage`.

## Approving held runs

Use the exact held run IDs returned for the current `head_sha`. Show the authorization prompt first. Only after explicit approval, run:

```bash
python3 .cursor/skills/community-pr/scripts/community_pr_gate.py authorize-held <number> <head_sha> \
  --approved-by-human \
  --run-id <id> [--run-id <id> ...]
```

The helper refuses missing, duplicate, non-PR, wrong-head, or newly materialized held runs. It verifies the head before each mutation, approves sequentially with raw `gh api`, reads every run back, and verifies the head again. Exit `22` means the head moved before mutation. Exit `23` means authorization may be partial; inspect the JSON readback and restart from the guarded snapshot before deciding whether to retry. Do not dispatch workflows.

## CI attribution

Treat a failure as contributor-caused only when the failing evidence points to changed code or files and the corresponding base check passes.

Before publication, run:

```bash
python3 .cursor/skills/community-pr/scripts/community_pr_gate.py ci-status <number> <head_sha> <base_sha> <binding_sha>
```

Take all three SHAs from the cleared snapshot. The helper checks the head before and after collection, evaluates exact `base_sha...head_sha` paths against the binding's `ci_config_prefix`, and automatically returns `infrastructure` only when CI configuration is unchanged, annotation evidence is complete, and every failure matches this narrow narrative allowlist:

- `fork-report-comment-permission`: the `publish-report` check says `Resource not accessible by integration` while trying to create a PR comment;
- `pathfinder-fork-bundle-comment-permission`: in `grafana/grafana-pathfinder-app`, the Bundle Stats `compare` check says `Resource not accessible by integration` while trying to report on a community PR.

For Pathfinder community PRs, these two fork-permission failures are expected infrastructure noise and count as passing CI when CI configuration is unchanged and no other failure evidence is present. Do not re-investigate them.

Everything else returns `unclear`, never automatic contributor attribution. Runner allocation, timeouts, network or registry failures, rate limits, image pulls, missing fork credentials, simultaneous unrelated failures, and passing reruns remain evidence for human attribution, not automatic signatures.

If attribution is unclear, escalate rather than post.

## Review handoff

Read [interfaces.md](interfaces.md), then resolve the review skill and policy from the `binding_sha` binding. Pass only the typed `ReviewHandoff`, containing:

- the immutable comparison base, binding, and head SHAs;
- the untrusted-input posture;
- genuine triage evidence such as a dependency, host, workflow, build, release, secret, token, or environment change.

Do not pass CLA, signing, merge-conflict, scanner-baseline, or authorization outcomes as review findings.

Reject a worker result whose `reviewed_head_sha` differs from the handoff. Before publication, render the exact `PublicationPreview` and require a separate explicit approval.

## Run trace

After reaching a terminal outcome, invoke `emit-trace` with the final structured state. It prints one JSON object to stdout and writes no file. Use `--would-be-next-state` only for dry runs.

## Merge boundary

Immediately before merge, rerun the complete snapshot to recheck CI, CLA, and every commit signature, then require the same head SHA as the reviewed result. This skill does not grant merge authority.
