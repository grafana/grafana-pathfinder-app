# Two-tab interactive controller

The interactive controller lets a guide popped out into its own browser tab
**drive interactivity in the original Grafana tab**. You read the guide on (say)
a second monitor and click "Show me" / "Do it" there; the highlight or action
runs against the live Grafana in the first tab.

It is the interactive sibling of the read-only guide reader (`?readonly=1`): same
full-screen overlay, but step controls stay visible and route their actions over
a cross-tab channel instead of executing locally.

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
- The controller and read-only tabs short-circuit in `module.tsx` and never
  install the executor; only the normal (live) load does.

## Key files by layer

| Concern                        | File                                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Deep-link param `controller=1` | `src/utils/pathfinder-search-params.ts`                                                                                   |
| Mount the controller overlay   | `src/module.tsx` (`?controller=1` short-circuit)                                                                          |
| Overlay + status badge         | `src/components/guide-reader/GuideReaderOverlay.tsx`                                                                      |
| "Interactive" affordance       | `src/components/docs-panel/utils/readonly-tab-open-action.ts` (`pickControllerTabOpenAction`), `DocsPanelContentArea.tsx` |
| Interactive mode enum          | `src/global-state/interactive-readonly-context.ts` (`InteractiveMode`, `useInteractiveMode`)                              |
| Transport                      | `src/lib/cross-tab-transport.ts` (`CrossTabTransport`)                                                                    |
| Message protocol               | `src/types/cross-tab.types.ts`                                                                                            |
| Controller emit + presence     | `src/global-state/controller-channel.tsx` (`ControllerChannelProvider`, `useControllerChannel`)                           |
| Per-step emit                  | `src/components/interactive-tutorial/interactive-step.tsx` (handlers branch on `useInteractiveMode()`)                    |
| Live-tab executor              | `src/integrations/cross-tab/live-tab-executor.ts` (`installLiveTabExecutor`)                                              |

## Message protocol

`CrossTabMessage` (`types/cross-tab.types.ts`) is a discriminated union sent over
the `pathfinder-cross-tab` channel. Every message carries an envelope
(`source: 'pathfinder'`, a per-tab `senderId` used to drop self-echoes, and a
`timestamp`):

- `step-command` — `{ phase: 'show' | 'do', stepId, action: { targetAction, refTarget, targetValue?, targetComment? } }`
- `heartbeat` — `{ role: 'controller' | 'live' }`

The transport degrades to a no-op where `BroadcastChannel` is unavailable, so
mounting the provider or executor is always safe.

## Presence

The controller pings a `controller` heartbeat on an interval; the live executor
replies with a `live` heartbeat for each ping it receives. The controller marks
itself connected on the first reply and stale (back to "waiting") if none arrives
within the timeout — so closing or navigating away from the live tab flips the
badge.

## v1 scope and limitations

- **Only `interactive-step` (the standard Show me / Do it) is routed.** Multi-step,
  guided, section, quiz, terminal, and challenge blocks render in the controller
  tab but are not yet wired to the live tab. Quiz grading is local, so it still
  works in the controller tab; terminal / challenge need a shared VM session and
  are out of scope.
- **Multiple live tabs** all execute a command (no targeting). Acceptable for v1.
- Completion sync rides the existing `completion-store` cross-tab storage event
  when the same guide is open in the live tab; otherwise it is not yet propagated.

## Extending to more step types

1. In the step component's click handler, branch on `useInteractiveMode() === 'controller'`
   and call `useControllerChannel()?.post(...)` with a `step-command` (mirror
   `interactive-step.tsx`) instead of executing locally.
2. If the action shape differs (e.g. `internalActions` for multi-step / guided),
   extend `CrossTabAction` / `CrossTabMessage` and handle the new shape in
   `live-tab-executor.ts`.
