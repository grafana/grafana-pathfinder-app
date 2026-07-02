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
  Composite steps carry their ordered sub-actions in `internalActions`. A
  `multistep` replays with staged pacing (see [Replay pacing](#replay-pacing));
  a `guided` step runs through the live tab's `GuidedHandler` instead — it
  highlights each target and waits for the user.
- `step-complete` — `{ stepId, ok }`, live → controller, signals a composite
  actually finished so the controller marks completion only then.
- `step-progress` — `{ stepId, index, total }`, live → controller, reports which
  internal action a composite is replaying so the controller can animate per-step
  progress while it runs on the live tab.
- `heartbeat` — `{ role: 'controller' | 'live' }`
- `check-requirements` / `requirement-result` — the requirement round-trip
  (controller → live → controller), correlated by `requestId`.
- `fix-requirement` / `fix-result` — a "Fix this" routed to the live tab,
  correlated by `requestId`.

The transport degrades to a no-op where `BroadcastChannel` is unavailable. The
provider is inert until a tab actually drives one; the executor, however, is a
DOM sink and is **not** unconditionally safe to install — see the trust model.

## Entry gate and mount policy

Both the controller overlay (`?controller=1` path) and the live-tab executor install are gated on two conditions: the `enableTwoTabController` admin setting (plugin config → Interactive features, default **off**), and `pathfinderEnabled` (the `pathfinder.enabled` kill-switch) — the same policy that controls whether the main Pathfinder sidebar mounts. The admin setting ships the feature dark until an instance opts in; the kill-switch keeps it aligned with the rest of the plugin. Because the executor drives the user's authenticated Grafana DOM, it must follow the same mount gate as the rest of the plugin.

## Security / trust model

> **Reviewing a change in this subsystem?** The `cross-tab-controller` concern in
> [`docs/design/CONCERNS.md`](../design/CONCERNS.md) is the canonical review checklist
> for these files. It fires on any single touch of the cross-tab files and enumerates
> the trust invariants below — signed commands, gesture-to-accept pairing, the per-kind
> validation gate, and the `enableTwoTabController` re-enable one-way door — that a
> reviewer must confirm before merge.

`BroadcastChannel` is shared by every script running on the same origin, so a
message on `pathfinder-cross-tab` is **not** proof it came from a Pathfinder
controller — a compromised co-plugin, a panel/datasource XSS, or a browser
extension content script could forge one. The live-tab executor turns messages
into real actions (navigate, button clicks, form fills) against the user's
authenticated Grafana, so a forged message that reached the executor sink could
drive that Grafana. The controller→live command path is therefore
**authenticated**, not merely validated:

- **Launch binding.** The live tab mints a one-time launch
  (`pairingId` + HMAC secret + 6-digit code) and embeds it in the controller
  tab's URL fragment when it opens the tab (`createControllerPairingLaunch`,
  `buildControllerPairingHash`). The controller proves it holds that secret with
  an HMAC over the canonical challenge `{pairingId, publicKeyB64, sessionId}`.
  The live tab accepts a challenge only when it matches a registered, unexpired
  launch — a wrong secret, a mutated `sessionId`/`publicKeyB64`, or an unknown
  `pairingId` is dropped (`pairing-manager.ts`). The reverse `pairing-accept`
  carries an HMAC over `{pairingId, sessionId, liveTabId}` keyed by the same
  launch secret, so the controller binds its pairing slot only to an accept it
  can attribute to the launched tab — a forged accept (`sessionId` is readable
  off the wire) can't take the slot.
- **Per-session keypair.** The controller generates a **non-extractable** ECDSA
  P-256 keypair per session; only the public key crosses the wire
  (`cross-tab-crypto.ts`). Authority to drive the live tab _is_ possession of
  that private key, which lives only in the controller tab's memory and is
  unrecoverable once that tab closes.
- **Consent gesture.** Pairing is accepted only on a trusted user gesture on the
  live tab (`acceptSession(..., trustedGesture)`); a programmatic or untrusted
  accept does nothing. Competing valid challenges fail closed (the prompt is
  cleared and both launches revoked); a rejected session stays suppressed; an
  expired pending challenge can be retried.
- **Signed commands.** Every side-effecting message — `step-command`,
  `check-requirements`, `fix-requirement`, `sidebar-handoff` — is ECDSA-signed
  and bound to `sessionId`, `liveTabId`, the command body, a fresh `sigNonce`,
  and a `sigTs`. The executor's auth gate (`verifySignedMessage`) checks the
  accepted session, the `sessionId`/`liveTabId` match, the timestamp window (up
  to 30s old, at most 1s future-dated since both tabs share a clock), the
  signature against the accepted public key, and a session-wide
  `(sessionId:sigNonce)` replay ledger before any action runs.

Defense in depth on top of authentication:

- **Per-kind validation.** Every inbound message is checked against
  `validateCrossTabMessage` (`types/cross-tab.types.ts`) — envelope plus the
  kind-specific shape, with `step-command` actions restricted to a known verb
  set — at the transport receive gate _and_ again at the executor sink. Malformed
  or unknown-kind messages are dropped before the auth gate is even consulted.
- **Install/entry gating.** The executor is installed, and the controller
  overlay mounted, only when the `enableTwoTabController` admin setting is on
  _and_ `pathfinderEnabled` is true — a disabled plugin, or an instance that
  hasn't opted in, exposes neither the sink nor the driver.
- **Same-build / same-origin / one-session assumption.** Controller and live
  tabs are the same plugin build in the same browser profile and session; there
  is no protocol-version negotiation and cross-version compatibility is not a
  goal.

### Known limitations / future work

**Replies are unauthenticated (by design).** Authentication covers the
controller→live **command** direction. The reverse direction — `requirement-result`,
`fix-result`, `step-progress`, `step-complete`, and the `live` heartbeat — is
**not** signed. The controller trusts replies whose `senderId` matches its paired
tab (see [Tab pairing](#tab-pairing)), but `senderId` is a forgeable plaintext
field, so a same-origin script can spoof reply _content_ — telling the controller
a requirement passed, a fix succeeded, or a step completed when it did not, or
faking presence. It **cannot** issue commands or cause any action on the live tab;
that still requires the controller private key. Replies are correlated by an
unguessable `requestId`, which raises the bar for blind forgery. Signing replies
is deliberately out of scope: it would require the live tab to mint and the
controller to verify a second keypair, to defend against an attacker who — by
assumption — already has same-origin code execution and strictly more direct
targets (session cookies, the Grafana API).

**No post-accept revoke affordance.** There is no on-demand "disconnect" API for
an already-accepted controller. This is intentional: authority is the controller
private key, so closing the controller tab is the disconnect — the key becomes
unreachable and no further command can be signed. The accepted session lingering
in live-tab memory afterward is inert (no key exists to use it), and the ±30s
window plus the replay ledger kill any captured in-flight message.

**Out of scope: same-origin code execution.** XSS or a malicious script running
_inside_ the controller or live tab is out of scope — it already holds the
session (and, in the controller, the signing key), so the cross-tab boundary is
not the relevant control. This includes capturing the launch secret: it reaches
the controller through a `window.open` URL fragment, so a same-page script
(panel/datasource XSS) or an extension content script with page access can read
it and forge a valid challenge or accept proof. The authenticated pairing path
therefore defends specifically against a **separate same-origin tab that only
observes the channel** — it can post forged messages but cannot read the secret,
so it can neither pair as the controller nor claim the live tab's pairing slot.
Non-extractable keys and per-kind validation are hardening, not a defense
against an already-compromised origin.

## Tab pairing

A controller binds to the **first live tab that answers** its heartbeat and
records that tab's `senderId` (`controller-channel.tsx`). It then ignores
replies — `requirement-result`, `fix-result`, `step-complete` — from any other
tab, so a second Grafana tab can't answer a requirement check with a different
DOM state. It re-pairs if the bound tab goes stale. Commands themselves are still
broadcast (every live tab executes them); only the replies the controller trusts
are scoped to the paired tab.

## Replay pacing

A `multistep` posts a single `step-command` (`phase: 'do'`) carrying its
`internalActions`. The live-tab executor replays each action the way a normal
multi-step paces itself — highlight (show) → pause → perform (do) → settle →
inter-step pause — so the user watches the same staged sequence in the live tab
rather than an instant burst. Pacing constants come from
`INTERACTIVE_CONFIG.delays.multiStep` and are injectable for tests. A `guided`
step is **not** auto-replayed: the executor runs each action through
`GuidedHandler` so the user performs it on the live tab. Either way the executor
posts `step-complete` when the sequence finishes, and the controller waits for
that before marking the step done (so a guided step isn't completed on click).

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

- **Routed:** `interactive-step` (Show me / Do it), multi-step (staged replay),
  and guided (runs through `GuidedHandler` on the live tab). Requirements —
  including tab-local ones — are evaluated and fixed on the live tab, re-checked
  at click time so a regressed prerequisite gates, and composites complete only
  once the live tab reports `step-complete`.
- **Replies scoped to one live tab:** a controller trusts requirement/fix/
  completion replies from a single paired tab; see [Tab pairing](#tab-pairing).
  Commands are still broadcast, so multiple live tabs all execute them.
- **Not yet routed:** a section's aggregate "Do section" runs its child steps
  directly rather than emitting one command; quiz grading is local (so it still
  works in the controller); terminal / challenge need a shared VM session and are
  out of scope.
- Completion sync rides the existing `completion-store` cross-tab storage event
  when the same guide is open in the live tab; otherwise it is not yet propagated.

## Extending to more step types

1. In the step component's click handler, branch on `useInteractiveMode() === 'controller'`
   and call `useControllerChannel()?.post(...)` with a `step-command` (mirror
   `interactive-step.tsx`) instead of executing locally.
2. If the action shape differs (e.g. `internalActions` for multi-step / guided),
   extend `CrossTabAction` / `CrossTabMessage` and handle the new shape in
   `live-tab-executor.ts`.
