# Panel-mode persistence

> Canonical rationale for `src/global-state/panel-mode.ts`. The persistence
> contract is enforced in code by three mode mutators, a non-persisting
> transient-session closer (`endTransientSession`), and the transient predicate
> (`isTransient`), pinned behaviourally by `panel-mode.test.ts` and by the source
> tripwire `components/full-screen/panel-mode-surface-toggles.contract.test.ts`.

## Purpose

Pathfinder renders guides on one of three **surfaces**: the Grafana extension
sidebar, a free-floating draggable panel, or a full-screen page. `panelMode` is
the user's surface choice. Two things must be tracked separately, and conflating
them is the source of every bug this document exists to prevent:

- the **current surface** — what the user sees right now, and
- the **persisted preference** — the value in `localStorage` that a fresh page
  load restores.

They diverge because a guide launched from **My Learning** picks the surface
that best fits its content (prose → full screen; interactive → beside Grafana),
and that automatic choice must **not** become the user's durable preference.

## The two axes and the three mutators

`localStorage[StorageKeys.PANEL_MODE]` holds the persisted preference.
`_transientMode` holds the in-memory current surface; when non-null it wins over
localStorage for `getMode()`, and its non-nullness **is** the flag "a transient
auto-launch session is active" (there is no separate boolean).

| Mutator            | Writes localStorage?           | Gesture it models                                                                                                           |
| ------------------ | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `setModePersisted` | Always                         | Deliberate surface **adoption**: pop-out, switch-to-fullscreen, the floating dock-to-sidebar pill, deep links               |
| `setModeTransient` | Never                          | Automatic launch selection (a guide chooses its surface)                                                                    |
| `setMode`          | Only when no transient session | Everything else: automatic teardown / auto-dock / self-heal / cold-load sync, and the fullscreen **return**-to-sidebar exit |

`setMode` is **conditional** on purpose: while a transient session is active it
updates the current surface without touching the stored preference (so leaving
an auto-launched surface restores the real preference); outside a session it
persists (so returning from a surface the user chose themselves sticks).

## Decision records

### Decision 2 — an automatic launch never overwrites the stored preference

A guide auto-launched from My Learning uses `setModeTransient`, which never
writes localStorage, and every automatic teardown/exit on the way back uses the
conditional `setMode`, which is suppressed while the session is open. So the
round-trip "launch → read → leave" leaves the stored preference exactly as it
was. This is the load-bearing invariant behind the whole launch-surface feature
(#1446); the transient machinery exists to guarantee it.

### Decision 3 (#1449) — the dock pill adopts; the fullscreen exit returns

**Problem.** The floating "dock to sidebar" pill used the conditional `setMode`.
So a floating-preference user who docked got different results depending on
invisible history: in a fresh session the dock persisted `sidebar`; but if they
had launched _any_ guide earlier in the session (leaving a transient session
open), the identical click silently did not persist, and floating came back on
reload. Same gesture, different outcome, no visible cause.

**Decision.** Classify the two sidebar transitions by intent, not by session
state:

- **Dock-to-sidebar pill → `setModePersisted('sidebar')`.** Docking is a
  deliberate "put my panel in the sidebar" **adoption**. It now persists
  consistently, whether or not a guide was auto-launched earlier. It is the
  durable inverse of pop-out-to-floating (which already persists), so the two
  buttons behave as symmetric toggles — the most predictable model for a user.
- **Fullscreen back-arrow / "return to sidebar" notice → conditional `setMode`
  (unchanged).** These are **returns**, not adoptions. Leaving a _transient_
  fullscreen (e.g. a prose guide auto-launched from My Learning) must restore
  the user's real preference — persisting `sidebar` here would let an automatic
  launch overwrite the preference through the back door, violating decision 2.
  Leaving a fullscreen the user _chose_ themselves still persists, because no
  session is active.

**Why this asymmetry is not the bug we just fixed.** The dock inconsistency was
bad because the _same visible situation_ produced different outcomes from hidden
history. The dock/exit split is different: docking and exiting are different
gestures with different intent, and each lands on the outcome the user wants in
both the transient and durable cases.

### Rejected — make `setMode` never persist

#1449 originally proposed going further: let only `setModePersisted` ever write
localStorage, so `setMode` becomes purely in-memory. That would delete the
conditional, the `_transientMode !== null` persistence gate, and the source
tripwire — persistence would be "structural" and impossible to get wrong at a
call site.

We rejected it because it regresses a **common** flow. A user reaches durable
full screen via the sidebar's "full screen" button
(`setModePersisted('fullscreen')`). Today the back-arrow returns them to the
sidebar durably (conditional `setMode` persists because no session is active).
If `setMode` could never persist, the back-arrow could no longer record that
choice, and there is **no other** "adopt the sidebar" control on the full-screen
surface — so on reload they would snap back to full screen with no way out short
of clearing storage. That is the same no-revert trap we rejected when we chose
to make the dock persist (decision 3) rather than making it never persist.

The conditional `setMode` is intentional. Do **not** "simplify" it into an
unconditional in-memory write; doing so silently reintroduces this regression.

### Decision 4 (#1448) — browser Back out of a transient prose launch exits quietly

A prose guide launched from My Learning auto-picks full screen
(`setModeTransient('fullscreen')`), expressing no durable surface preference.
Browser **Back** out of that launch previously fell through to the auto-dock's
return-to-sidebar path, reopening a closed extension sidebar with the prose
squeezed in.

**Decision.** On a history **POP** while a transient session is active, the
auto-dock (`dockOnLeavingFullScreen`) ends the session via `endTransientSession`
— which drops the in-memory override so `getMode()` falls back to the stored
preference — and forces no surface open (outcome `'transient_back'`). The exit
is **always** quiet: the prior surface is deliberately never captured or
restored, so Back never reopens a surface the launch didn't durably choose.
PUSH/REPLACE keep today's dock (an interactive `navigate` step leaving full
screen still needs a panel to continue in), and a non-transient POP (a
deliberately-adopted full screen) docks too. history v4 cannot tell Back from
Forward — both are POP — which is accepted for this quiet exit.

`endTransientSession` neither persists (the launch never chose a preference —
decision 2) nor dispatches `PANEL_MODE_CHANGE_EVENT` (the surface is already
unmounted, so no live listener). Its call is deferred so `FullScreenPanel`'s
unmount cleanup runs first while `getMode()` is still `'fullscreen'`; see the
code comments for that hazard and the dead-state hazard it also avoids.

## What is safe to change vs. load-bearing

- **Safe:** collapsing bookkeeping that is provably redundant. `_transientActive`
  was removed in #1449 because it equalled `_transientMode !== null` across every
  mutator — one bit, one field.
- **Load-bearing:** the persist-iff-no-session behaviour of `setMode`; the
  per-gesture classification in the tripwire; that `setModeTransient` opens the
  session even when the surface does not visibly change (so an auto-launch to the
  already-current surface is still protected).

## Related

- Return-path interaction with browser Back on a transient prose launch:
  **#1448** (resolved — see decision 4). The Grafana nav-click-with-prose
  annoyance is a separate follow-up needing an interactive-step-in-progress
  signal, still to be filed.
- Auto-open listener ownership across surfaces: **#1450**.
