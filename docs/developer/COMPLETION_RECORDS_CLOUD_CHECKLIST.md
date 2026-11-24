# Completion records: cloud round-trip checklist

A manual checklist for one operator, run against a real Grafana Cloud stack, to confirm that a reader's completion becomes a durable completion record.

This checklist exercises the registered SDK provider on a Cloud stack using your signed-in identity. The local SDK browser suite also tests completion writes against real Grafana storage.

## Before you start

You need:

- A Grafana Cloud stack you are authorized to use, signed in as yourself.
- The SDK frontend and backend builds you intend to test. For a local frontend change, see [serving a local build into a Cloud stack](#serving-a-local-build-into-a-cloud-stack).
- The stack open in a browser with devtools. Every request below is issued from the devtools console on a Grafana tab, not with `curl`: the routes ride the caller's own identity, and a console request carries the session the browser already holds.

Build the SDK route prefix from the current stack’s namespace:

```js
var namespace = window.grafanaBootData.settings.namespace;
if (!/^stacks-[0-9]+$/.test(namespace)) {
  throw new Error('Expected a concrete Cloud stack namespace');
}
var PF = `/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/${encodeURIComponent(namespace)}/backend`;
```

### 0. Check the installed plugin version first

```js
await fetch('/api/plugins/grafana-pathfinder-app/settings')
  .then((r) => r.json())
  .then((s) => s.info.version);
```

Record the installed frontend version. Check the backend separately with the capability request in step 1. For a 404, verify that this stack serves the intended SDK build and that Grafana registered its routes.

## Every assertion is a count delta, never an absolute count

`GET /completion-records/my` collates records by `(guideSource, guideId)` and reports a running `count` per pair. There is no route that deletes a durable completion record, and nothing expires them, so those counts only ever go up — per reader, per stack, forever. The second time you run this checklist the counts are already non-zero, and they stay non-zero for every later run.

So **read the count before the action, read it after, and assert the difference.** A step that expects a count of exactly 1 passes the first time anyone runs it and fails for everyone afterwards. Please do not "fix" a delta assertion into an absolute one.

## Paste these helpers into the console first

Four of them. `completionSnapshot` reads the whole collated array as a lookup, because a step often has to take a baseline before it knows which pair a guide records under; `completionCount` narrows that to one pair and answers `0` for a pair with no record yet; `waitForDelta` polls for a count to move, at the spacing the forced-read rate limit allows; `queuedFacts` reads the client's own write queue, which is where you find out what pair a completion actually used.

Every step below draws on this one block, so **this is the block to re-paste if the console's context is ever cleared** — which step 3 does deliberately, when it reloads the page.

The snippets declare their working values with `var`, not `const`, and that is deliberate: later steps re-derive the same names (`before`, `guideSource`, `guideId`, `baseline`) and a `const` would throw `Identifier has already been declared` in a console that has already seen them. Please leave them as `var`.

```js
async function completionSnapshot({ refresh = false } = {}) {
  const url = `${PF}/completion-records/my${refresh ? '?refresh=1' : ''}`;
  const body = await fetch(url).then((r) => r.json());
  if (!body.capability?.available) {
    throw new Error(`capability unavailable: ${body.capability?.reason ?? 'unknown'}`);
  }
  return Object.fromEntries((body.completions ?? []).map((c) => [`${c.guideSource}\t${c.guideId}`, c.count]));
}

async function completionCount(guideSource, guideId, options) {
  return (await completionSnapshot(options))[`${guideSource}\t${guideId}`] ?? 0;
}

// Polls a pair's count until it has risen by `expected`. The read route answers
// from a per-caller, per-namespace cache with a five-minute TTL, so a single read will often
// miss a completion that did land; `?refresh=1` forces an upstream read and is
// itself rate-limited to one per caller and namespace per 30 seconds, which is why the poll
// spacing is 30 seconds and not tighter.
async function waitForDelta(guideSource, guideId, baselineCount, expected, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const now = await completionCount(guideSource, guideId, { refresh: true });
    if (now - baselineCount >= expected) {
      return now;
    }
    if (Date.now() > deadline) {
      throw new Error(`record never arrived: count stayed at ${now}, baseline ${baselineCount}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 30_000));
  }
}

// The client's queued-but-unsent completion facts. `guideId` narrows to one
// guide — after a failed earlier step there can be several queued at once.
function queuedFacts(guideId) {
  const QUEUE = 'grafana-pathfinder-app-completion-write-queue-v2:';
  return Object.keys(localStorage)
    .filter((key) => key.startsWith(QUEUE) && key.includes(':item:'))
    .map((key) => ({ key, item: JSON.parse(localStorage.getItem(key)) }))
    .map(({ key, item }) => ({ key, id: item.id, ...item.body }))
    .filter((fact) => guideId === undefined || fact.guideId === guideId);
}
```

## 1. Preflight: the capability route says yes

Run this first, every time:

```js
await fetch(`${PF}/completion-records/capability`).then((r) => r.json());
// → { available: true }
```

Continue when the response contains `available: true`. For `identity-unavailable`, check the signed-in caller and namespace. For `obo-unavailable`, verify that the provider can use caller-delegated credentials. For `backend-unavailable`, inspect the diagnostics for the upstream completion-record list request and its status. For HTTP 503, record the diagnostics and retry after the interval in `Retry-After`.

## 2. A completion becomes a durable record

**Do not work out the `(guideSource, guideId)` pair by hand.** It is not simply the manifest's `repository` and `id`: the same guide launched by package path rather than by bare id records a different `guideId`, App Platform guides are forced to `app-platform`, and a milestone is keyed on its own slug and never on the owning path's id. Guess it wrong and you see no delta and report a working system as broken. Read it off the completion the client actually built instead.

1. Take a baseline of the whole collated array, since you do not yet know the pair: `var before = await completionSnapshot();`
2. In the sidebar, open a guide and complete it — click **Mark complete** at its foot.
3. Read the pair off the queued fact, promptly — the queue removes an item once it is sent:

```js
var [fact] = queuedFacts();
var { guideSource, guideId } = fact;
({ guideSource, guideId });
```

If the queue is already empty the fact has drained, which is the good case. Fall back to diffing the whole array:

```js
var drained = await completionSnapshot({ refresh: true });
Object.entries(drained).filter(([pair, seen]) => seen !== (before[pair] ?? 0));
// → exactly one entry, `"<guideSource>\t<guideId>": <before + 1>`
```

4. Poll for the record to appear, with `waitForDelta` from the helper block. It allows for the read cache and the forced-read rate limit, so give it time rather than reading once:

```js
var baseline = before[`${guideSource}\t${guideId}`] ?? 0;
var after = await waitForDelta(guideSource, guideId, baseline, 1);
```

**Pass:** `after - baseline === 1`.

A timeout here means **the record never arrived**. Treat it as a failure and report it — not as a flake to re-run until it passes. The poll above already allows for the cache, the forced-read rate limit, and the write queue's own backoff; if three minutes of that is not enough, something is wrong.

## 3. A retry cannot double-count

The client retries a completion whose POST it could not confirm, replaying it under the same stable idempotency key. The backend derives the record name from that key, so a replay must collapse into the one record rather than adding a second.

1. Take a whole-array baseline: `var before = await completionSnapshot();`
2. In devtools, set the network to **Offline** (Network panel → throttling → Offline).
3. Complete a guide you have **not** completed on this stack. The completion cannot leave the browser, so it stays in the client's queue.
4. Copy that guide's queued fact out of `localStorage`, still offline. Filter by the guide id rather than taking the first item — a failed earlier step can leave others queued:

```js
var [fact] = queuedFacts(); // one guide completed while offline, so one fact
var { guideSource, guideId } = fact;
var saved = { key: fact.key, value: localStorage.getItem(fact.key) };
// If several are queued, narrow it: queuedFacts('<the guide id>')
saved; // keep this in the console — you re-write it in step 6
```

5. Set the network back to **Online** and wait for the delta with the poll from step 2. It should be `+1`.

```js
var baseline = before[`${guideSource}\t${guideId}`] ?? 0;
await waitForDelta(guideSource, guideId, baseline, 1);
```

6. Force the resend. **The reload on the next line wipes the console's JS context** — `PF`, every helper, `saved`, `guideSource`, `guideId` and `baseline` all go with it — so stash what steps 7 and 8 need somewhere that survives it first. `sessionStorage` is the right place: it lives through a reload in the same tab, and no longer.

```js
sessionStorage.setItem(
  'pathfinder-checklist-replay',
  JSON.stringify({ savedKey: saved.key, guideSource, guideId, baseline })
);
localStorage.setItem(saved.key, saved.value);
location.reload();
```

7. **Re-paste two things before you run anything else in this step**, because the reload cleared them:

   - the SDK route prefix snippet from [before you start](#before-you-start), and
   - the whole [helper block](#paste-these-helpers-into-the-console-first).

   Skip this and every snippet below fails with a `ReferenceError`, at exactly the moment this step is trying to tell you something. Re-declaring them is safe here: the reload gave you a fresh context.

   Then restore the stash:

```js
var replay = JSON.parse(sessionStorage.getItem('pathfinder-checklist-replay') ?? 'null');
if (!replay) {
  throw new Error('no stashed replay state — start step 3 again from the beginning');
}
var { savedKey, guideSource, guideId, baseline } = replay;
replay;
```

8. **Confirm the replay actually left the browser, before you read any count.** This is the step's whole point and the one place a wrong result is worse than no result: a replay that never sent produces the same count as a replay that was correctly deduped, so without a positive check a silent no-op reads as a pass and reports the idempotency guarantee as verified when nothing was tested.

   The queue removes an item once it has been sent successfully, so the saved key going `null` is the confirmation:

```js
async function waitForResend(key, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (localStorage.getItem(key) === null) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error('the replay never left the browser — the queue item is still there');
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

await waitForResend(savedKey);
```

Cross-check it visually if you like: a second `POST .../backend/completion-records` in the Network panel.

**Expect this to take around half a minute.** Only one tab drains at a time, under a 30-second lease, and a page that navigates away strands its lease to expire rather than releasing it — so the first send after a reload commonly waits out the full lease. The browser suite measures this at a consistent ~34 seconds. Do not shorten the timeout to under a minute, and do not conclude anything from a count read before `waitForResend` returns.

9. Read the count again, and clear the stash so a later run of this checklist cannot pick up this one's state.

```js
var count = await completionCount(guideSource, guideId, { refresh: true });
sessionStorage.removeItem('pathfinder-checklist-replay');
({ baseline, count, delta: count - baseline });
```

**Pass:** `delta` is `1`. The whole sequence — original send plus a confirmed replay — produced exactly one record.

**Fail, two different ways:**

- `delta` is `2` — a double-count. This is the failure the step exists to catch.
- `waitForResend` times out — the replay never sent, so the guarantee is untested, not verified. Report it as an inconclusive step, not a pass.

## 4. A whole path records only when every milestone is complete

A path has a record of its own, separate from its milestones'. It must appear when the last milestone completes, and not before.

1. Pick a path with at least three milestones that you have not progressed on this stack.
2. Take a whole-array baseline: `var before = await completionSnapshot();` — as in step 2, do not derive the path's pair by hand.
3. Complete every milestone except the last, using **Complete milestone**, then **Continue** to open the next one. The controller overlay retains **Mark complete and continue**.
4. Read the array again with `?refresh=1` and diff it against `before`.

   **Pass:** the only new or increased entries are the milestones you completed, each keyed on its own slug. **No new entry keyed on the path itself.** A path record before the last milestone is a failure, and the more damaging direction of the two: it reports readers as finished when they are not.

5. Complete the last milestone. Read the path's own pair off the queue while it is still there — the path's record is a second, separate fact emitted alongside the last milestone's. The path's fact is the one whose `guideId` is the path's id rather than a milestone slug:

```js
queuedFacts(); // the last milestone's fact, plus the path's own
```

Take the path's pair from that fact and set the baseline for it:

```js
// Pick the path's own entry out of the list above — the one whose guideId is
// the path's id, not a milestone slug — and change the index to match.
var pathFact = queuedFacts()[0];
var { guideSource: pathSource, guideId: pathId } = pathFact;
var baseline = before[`${pathSource}\t${pathId}`] ?? 0;
({ pathSource, pathId, baseline });
```

If the queue has already drained, diff the array as in step 2 — the path's entry is the new one that is not a milestone slug.

6. Wait for the path's delta with the poll from step 2:

```js
var count = await waitForDelta(pathSource, pathId, baseline, 1);
({ baseline, count, delta: count - baseline });
```

**Pass:** `delta` is `1`.

**Fail:** `waitForDelta` throws, meaning the path record never arrived even though every milestone is complete — a path that can never be reported finished. Report it with the milestone records you did see in the same `/completion-records/my` response, since those say whether the milestones themselves landed.

Each milestone also records separately, keyed on its own slug. Those are worth spot-checking in the same `/completion-records/my` response, again as deltas.

## 5. What is not on this checklist

**Cross-reader privacy is not tested here.** The guarantee is that one reader's `/completion-records/my` never returns another reader's records, and checking it needs two real identities on the same stack signed in at the same time — which is more setup than this checklist is worth, and easy to get subtly wrong (two tabs under one identity would pass while proving nothing).

It is covered by inspection instead: the read path serves only `CompletionIndex.ByUser[caller]` (`pkg/services/completion_cache.go`), and the cache entry is keyed on the caller's verified namespace and subject, so a cache hit is structurally incapable of returning another reader's rows. See the identity trust boundary in [`../design/BACKEND_PROXY_PATTERN.md`](../design/BACKEND_PROXY_PATTERN.md) and the namespace and subject checks in `pkg/provider/completions.go`.

If you do want to exercise it, do it as a separate, deliberate two-identity session — not as a sixth step here.

## Serving a local build into a cloud stack

[Graft](GRAFT_TESTING.md) can serve a local frontend build into the test stack. Use the normal Cloud deployment process for backend changes and verify the SDK capability on the same stack.

## Related

- [`../design/COMPLETION-MODEL.md`](../design/COMPLETION-MODEL.md) — what each percentage and each record is supposed to mean.
- [`../design/BACKEND_PROXY_PATTERN.md`](../design/BACKEND_PROXY_PATTERN.md) — the route pattern and the identity trust boundary.
- `tests/completion-tracking.spec.ts` — the automated half, up to the network boundary.
