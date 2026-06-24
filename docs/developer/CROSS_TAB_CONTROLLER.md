# Two-tab interactive controller

The interactive controller lets a guide popped out into its own browser tab
**drive interactivity in the original Grafana tab**. You read the guide on (say)
a second monitor and click "Show me" / "Do it" there; the highlight or action
runs against the live Grafana in the first tab.

It reuses the full-screen guide-reader overlay: same overlay, but in controller
mode the step controls stay visible and route their actions over a cross-tab
channel instead of executing locally. (The overlay defaults to a non-driving
`interactive` mode; controller mode is an explicit opt-in via `?controller=1`.)

## How a user reaches it

The docs content-meta toolbar shows an **Interactive** button for guides with no
public doc page (`backend-guide:` / `api:` / interactive-learning packages —
`pickControllerTabOpenAction`). It opens a same-origin tab at
`/?doc=<guide>&controller=1`. Being same-origin, the new tab inherits the Grafana
session via cookies.

## Data flow

```
Controller tab (?controller=1)                Live Grafana tab (normal load)
──────────────────────────────                ──────────────────────────────
GuideReaderOverlay mode="controller"          module.tsx normal path
  └ ControllerChannelProvider                   └ installLiveTabExecutor()
      step click → emit step-command ───►  BroadcastChannel  ───► run via interactive-engine
      heartbeat (controller)  ───────────► 'pathfinder-cross-tab' ──► ack heartbeat (live)
      connection badge  ◄──────────────────────────────────────────┘
```

- **Same browser, same profile only.** `BroadcastChannel` is scoped to one
  browser profile. A different browser, profile, or device would need the WebRTC
  transport used by Workshop / Live Sessions, not this one.
- The controller tab short-circuits in `module.tsx` and never installs the
  executor; only the normal (live) load does.

## Key files by layer

| Concern                        | File                                                                                                                        |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Deep-link param `controller=1` | `src/utils/pathfinder-search-params.ts`                                                                                     |
| Mount the controller overlay   | `src/module.tsx` (`?controller=1` short-circuit)                                                                            |
| Overlay + status badge         | `src/components/guide-reader/GuideReaderOverlay.tsx`                                                                        |
| "Interactive" affordance       | `src/components/docs-panel/utils/controller-tab-open-action.ts` (`pickControllerTabOpenAction`), `DocsPanelContentArea.tsx` |
| Interactive mode enum          | `src/global-state/interactive-mode-context.ts` (`InteractiveMode`, `useInteractiveMode`)                                    |
| Transport                      | `src/lib/cross-tab-transport.ts` (`CrossTabTransport`)                                                                      |
| Message protocol               | `src/types/cross-tab.types.ts`                                                                                              |
| Controller emit + presence     | `src/global-state/controller-channel.tsx` (`ControllerChannelProvider`, `useControllerChannel`)                             |
| Per-step emit                  | `interactive-step.tsx`, `interactive-multi-step.tsx`, `interactive-guided.tsx` (handlers branch on `useInteractiveMode()`)  |
| Requirement round-trip         | `src/requirements-manager/step-checker.hook.ts` (controller branch), `controller-requirements.ts` (tab-local set)           |
| Live-tab executor              | `src/integrations/cross-tab/live-tab-executor.ts` (`installLiveTabExecutor`: replay, requirement eval, remote fix)          |

## Message protocol

`CrossTabMessage` (`types/cross-tab.types.ts`) is a discriminated union sent over
the `pathfinder-cross-tab` channel. Every message carries an envelope
(`source: 'pathfinder'`, a per-tab `senderId` used to drop self-echoes, and a
`timestamp`):

- `step-command` — `{ phase: 'show' | 'do', stepId, action: { targetAction, refTarget, targetValue?, targetComment?, internalActions? } }`.
  Composite steps (multi-step / guided) carry their ordered sub-actions in
  `internalActions`; the executor replays those with the same staged pacing a
  normal multi-step uses (see [Replay pacing](#replay-pacing)).
- `heartbeat` — `{ role: 'controller' | 'live' }`
- `check-requirements` / `requirement-result` — the requirement round-trip
  (controller → live → controller), correlated by `requestId`.
- `fix-requirement` / `fix-result` — a "Fix this" routed to the live tab,
  correlated by `requestId`.

The transport degrades to a no-op where `BroadcastChannel` is unavailable. The
provider is inert until a tab actually drives one; the executor, however, is a
DOM sink and is **not** unconditionally safe to install — see the trust model.

## Security / trust model

`BroadcastChannel` is shared by every script running on the same origin, so a
message on `pathfinder-cross-tab` is **not** proof it came from a Pathfinder
controller — a compromised co-plugin, a panel/datasource XSS, or a browser
extension content script could forge one. The live-tab executor turns messages
into real actions (navigate, button clicks, form fills) against the user's
authenticated Grafana, so the channel is treated as untrusted input:

- **Per-kind validation.** Every inbound message is checked against
  `validateCrossTabMessage` (`types/cross-tab.types.ts`) — envelope plus the
  kind-specific shape, with `step-command` actions restricted to a known verb
  set — at the transport receive gate _and_ again at the executor sink, before
  any action runs. Malformed or unknown-kind messages are dropped.
- **Install/entry gating.** The executor is installed, and the controller
  overlay mounted, only when `pathfinderEnabled` is true — a disabled plugin
  exposes neither the sink nor the driver.
- **Same-build / same-origin / one-session assumption.** Controller and live
  tabs are the same plugin build in the same browser profile and session; there
  is no protocol-version negotiation and cross-version compatibility is not a
  goal.

This is a same-origin trust posture, not authentication: validation constrains
_what_ a forged message can ask for, and gating limits _when_ the sink exists.

## Replay pacing

A composite step posts a single `step-command` (`phase: 'do'`) carrying its
`internalActions`. The live-tab executor replays each action the way a normal
multi-step paces itself — highlight (show) → pause → perform (do) → settle →
inter-step pause — so the user watches the same staged sequence in the live tab
rather than an instant burst. Pacing constants come from
`INTERACTIVE_CONFIG.delays.multiStep` and are injectable for tests.

## Requirement evaluation (round-trip)

A controller tab drives a _different_ Grafana tab, so requirements that probe
the live tab's DOM / URL (`exists-reftarget`, `navmenu-open`, `on-page:`,
`form-valid`) can't be evaluated locally. Rather than strip and ignore them, the
controller asks the live tab:

```
Controller (useStepChecker, controller mode)        Live tab (installLiveTabExecutor)
  requestRequirementCheck ─ check-requirements ─►  checkRequirements() against real DOM
  createRequirementsState ◄─ requirement-result ──  reply { pass, error[] (canFix/fixType) }
  "Fix this" → requestFix ─ fix-requirement ────►  dispatchFix() against real DOM
  recheck                 ◄─ fix-result ──────────  reply { ok, error? }
```

- The reply is a plain `RequirementsCheckResult`; it flows through the **same**
  `createRequirementsState` path the in-tab checker uses, so the warning and
  "Fix this" affordance render identically — no controller-specific UI.
- Evaluation and fixes run on the **live** side (tier 3 → requirements-manager,
  a legal downward import). `controller-channel.tsx` (tier 1) only correlates
  replies by `requestId` and carries the result as a tier-0 type — it must not
  import requirements-manager (upward).
- A controller-mode heartbeat polls while a fragile step is **blocked** (the
  in-tab watchdog only polls while enabled), so the warning clears once the
  prerequisite is met on the live tab.
- The round-trip does not depend on the `connected` heartbeat badge:
  `requestRequirementCheck` posts regardless of connection state (the channel
  value omits `connected`), so the check fires the moment a step renders;
  `connected` only drives the presence badge.
- If no live tab answers within the timeout, the check falls back to stripping
  the tab-local tokens and evaluating the rest locally — session/permission
  requirements still gate, and a disconnected controller never hangs.

## Presence

The controller pings a `controller` heartbeat on an interval; the live executor
replies with a `live` heartbeat for each ping it receives. The controller marks
itself connected on the first reply and stale (back to "waiting") if none arrives
within the timeout — so closing or navigating away from the live tab flips the
badge.

## Scope and limitations

- **Routed:** `interactive-step` (Show me / Do it), and multi-step / guided steps
  (their internal actions replay with staged pacing). Requirements — including
  tab-local ones — are evaluated and fixed on the live tab via the round-trip.
- **Not yet routed:** a section's aggregate "Do section" runs its child steps
  directly rather than emitting one command; quiz grading is local (so it still
  works in the controller); terminal / challenge need a shared VM session and are
  out of scope.
- **Multiple live tabs** all execute a command (no targeting). Acceptable for now.
- Completion sync rides the existing `completion-store` cross-tab storage event
  when the same guide is open in the live tab; otherwise it is not yet propagated.

## Extending to more step types

1. In the step component's click handler, branch on `useInteractiveMode() === 'controller'`
   and call `useControllerChannel()?.post(...)` with a `step-command` (mirror
   `interactive-step.tsx`) instead of executing locally.
2. If the action shape differs (e.g. `internalActions` for multi-step / guided),
   extend `CrossTabAction` / `CrossTabMessage` and handle the new shape in
   `live-tab-executor.ts`.
