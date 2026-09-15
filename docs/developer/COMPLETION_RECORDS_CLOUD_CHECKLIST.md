# Completion records: cloud round-trip checklist

A manual checklist for one operator, run against a real Grafana Cloud stack, to confirm that a reader's completion becomes a durable completion record.

It is deliberately not automated and there is no CI job for it. The round trip needs a real stack, a real forwarded identity, and an App Platform namespace that serves the record kind; a local Docker stack has none of those. The browser suite under `tests/` covers everything up to the network boundary — the percentage, the fact, and the identity it is keyed on — and stops there. This checklist covers the rest.

Work through the steps in order. Step 1 is a gate: if it fails, nothing after it can tell you anything useful.

## Before you start

You need:

- A Grafana Cloud stack you are authorized to use, signed in as yourself.
- A local `dist/` build of this plugin served into that stack (see [serving a local build into a cloud stack](#serving-a-local-build-into-a-cloud-stack)).
- The stack open in a browser with devtools. Every request below is issued from the devtools console on a Grafana tab, not with `curl`: the routes ride the caller's own identity, and a console request carries the session the browser already holds.

Throughout, `PF` is the plugin's resources prefix:

```js
const PF = '/api/plugins/grafana-pathfinder-app/resources';
```

## Every assertion is a count delta, never an absolute count

`GET /completion-records/my` collates records by `(guideSource, guideId)` and reports a running `count` per pair. There is no route that deletes a durable completion record, and nothing expires them, so those counts only ever go up — per reader, per stack, forever. The second time you run this checklist the counts are already non-zero, and they stay non-zero for every later run.

So **read the count before the action, read it after, and assert the difference.** A step that expects a count of exactly 1 passes the first time anyone runs it and fails for everyone afterwards. Please do not "fix" a delta assertion into an absolute one.

This helper reads the count for one pair, and answers `0` for a pair that has no record yet:

```js
async function completionCount(guideSource, guideId, { refresh = false } = {}) {
  const url = `${PF}/completion-records/my${refresh ? '?refresh=1' : ''}`;
  const body = await fetch(url).then((r) => r.json());
  if (!body.capability?.available) {
    throw new Error(`capability unavailable: ${body.capability?.reason ?? 'unknown'}`);
  }
  const entry = body.completions?.find((c) => c.guideSource === guideSource && c.guideId === guideId);
  return entry ? entry.count : 0;
}
```

## 1. Preflight: the capability route says yes

Run this first, every time:

```js
await fetch(`${PF}/completion-records/capability`).then((r) => r.json());
// → { available: true }
```

**Require `available: true` before you do anything else.** If it is `false`, stop here and report the `reason` token — it names which part of the layer is missing, and each one needs a different person to fix it:

| `reason`                   | What it means                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| `identity-unavailable`     | No acceptable caller token: absent, expired, or issued for another stack. Re-authenticate and retry. |
| `identity-unverifiable`    | The stack supplies nothing to verify a token against — no app URL, or no server-derived namespace.   |
| `signing-keys-unreachable` | No signing-keys endpoint answered at all. Points at the configured address, not at you.              |
| `backend-unavailable`      | Identity is fine; the record kind is not served on this stack, or the upstream LIST did not answer.  |

A `503` rather than a capability envelope is a transient hiccup, not an unavailable capability: wait for the `Retry-After` hint and try again.

Do not continue past a `false`. Every later step reads through the same gate, and would report the same failure less clearly.

## 2. A completion becomes a durable record

1. Pick a guide and note the `(guideSource, guideId)` pair it records under. The pair is the guide's manifest `repository` and `id`; for a bundled guide it is `bundled` and the guide's id.
2. Read the baseline: `const before = await completionCount(guideSource, guideId);`
3. In the sidebar, open that guide and complete it — click **Mark complete** at its foot.
4. Poll for the record to appear. The read route answers from a per-namespace cache with a five-minute TTL, so a single read will often miss a completion that did land. `?refresh=1` forces an upstream read, and is itself rate-limited to one forced read per namespace per 30 seconds, so poll at that spacing rather than tighter:

```js
async function waitForDelta(guideSource, guideId, before, expected, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const now = await completionCount(guideSource, guideId, { refresh: true });
    if (now - before >= expected) {
      return now;
    }
    if (Date.now() > deadline) {
      throw new Error(`record never arrived: count stayed at ${now}, baseline ${before}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 30_000));
  }
}

const after = await waitForDelta(guideSource, guideId, before, 1);
```

**Pass:** `after - before === 1`.

A timeout here means **the record never arrived**. Treat it as a failure and report it — not as a flake to re-run until it passes. The poll above already allows for the cache, the forced-read rate limit, and the write queue's own backoff; if three minutes of that is not enough, something is wrong.

## 3. A retry cannot double-count

The client retries a completion whose POST it could not confirm, replaying it under the same stable idempotency key. The backend derives the record name from that key, so a replay must collapse into the one record rather than adding a second.

1. Read the baseline for a guide you have **not** completed on this stack: `const before = await completionCount(guideSource, guideId);`
2. In devtools, set the network to **Offline** (Network panel → throttling → Offline).
3. Complete the guide. The completion cannot leave the browser, so it stays in the client's queue.
4. Copy the queued fact out of `localStorage`, still offline:

```js
const QUEUE = 'grafana-pathfinder-app-completion-write-queue-v2:';
const key = Object.keys(localStorage).find((k) => k.startsWith(QUEUE) && k.includes(':item:'));
const saved = { key, value: localStorage.getItem(key) };
saved; // keep this in the console — you re-write it in step 6
```

5. Set the network back to **Online** and wait for the delta with the poll from step 2. It should be `+1`.
6. Force the resend: write the saved item back under its original key and reload the page. The queue drains it again, under the same idempotency key as before.

```js
localStorage.setItem(saved.key, saved.value);
location.reload();
```

7. Wait long enough for the resend to be attempted — the queue drains on load — then read the count again.

**Pass:** the count is still `before + 1`. The whole sequence, original send plus replay, produced exactly one record.

**Fail:** `before + 2`. That is a double-count, and it is the failure this step exists to catch.

## 4. A whole path records only when every milestone is complete

A path has a record of its own, separate from its milestones'. It must appear when the last milestone completes, and not before.

1. Pick a path with at least three milestones that you have not progressed on this stack. Note the path's own `(guideSource, guideId)` pair — its manifest `repository` and `id`.
2. Read the baseline for the **path's** pair: `const before = await completionCount(pathSource, pathId);`
3. Complete every milestone except the last, using **Mark complete and continue**.
4. Read the path's count again, with `?refresh=1`.

   **Pass:** unchanged — `count - before === 0`. A path record before the last milestone is a failure, and it is the more damaging direction of the two: it reports readers as finished when they are not.

5. Complete the last milestone.
6. Wait for the path's delta with the poll from step 2.

   **Pass:** `count - before === 1`.

Each milestone also records separately, keyed on its own slug. Those are worth spot-checking in the same `/completion-records/my` response, again as deltas.

## 5. What is not on this checklist

**Cross-reader privacy is not tested here.** The guarantee is that one reader's `/completion-records/my` never returns another reader's records, and checking it needs two real identities on the same stack signed in at the same time — which is more setup than this checklist is worth, and easy to get subtly wrong (two tabs under one identity would pass while proving nothing).

It is covered by inspection instead: the read path serves only `idx.byUser[caller]`, keyed on the caller's verified ID-token subject, so a cache hit is structurally incapable of returning another reader's rows. See the identity trust boundary in [`../design/BACKEND_PROXY_PATTERN.md`](../design/BACKEND_PROXY_PATTERN.md) and `deriveCompletionUserID` in `pkg/plugin/completion_records.go`.

If you do want to exercise it, do it as a separate, deliberate two-identity session — not as a sixth step here.

## Serving a local build into a cloud stack

The reason this checklist needs a local build at all: the reader-facing half of completion tracking — earned progress and the universal **Mark complete** control — is on `main` and in no tagged release, while the server half shipped in 2.17.0. So a released plugin on a Cloud stack cannot produce the completions this checklist wants to read.

[Graft](https://github.com/grafana/plugin-graft) (`grafana/plugin-graft`, Grafanista-only) closes that gap: it serves a locally built `dist/` into a real Cloud stack. Build with `npm run build` (or leave `npm run dev` running) and point Graft at this repo's `dist/`.

**Graft's limit matters here.** It serves reader-facing files only. It cannot replace a plugin's server component, so the routes in step 1 onwards are the ones the stack's _installed_ plugin version serves — not yours. That is fine for this checklist, because the server half is already released and unchanged; it is not fine if you ever need to test a `pkg/` change, which needs a real plugin release instead.

For install, setup, and feature detail, use plugin-graft's own docs — [`GRAFT_TESTING.md`](GRAFT_TESTING.md) links them and is the place that owns this repo's Graft notes. Do not restate its setup here.

## Related

- [`../design/COMPLETION-MODEL.md`](../design/COMPLETION-MODEL.md) — what each percentage and each record is supposed to mean.
- [`../design/BACKEND_PROXY_PATTERN.md`](../design/BACKEND_PROXY_PATTERN.md) — the route pattern and the identity trust boundary.
- `tests/completion-tracking.spec.ts` — the automated half, up to the network boundary.
