# AI auto-heal (`ai-fix`)

AI auto-heal adds an opt-in "Fix this ✨" affordance to a **failing interactive step**. When a step's selector can't be matched and no deterministic recovery applies, the user can ask the Grafana Assistant to propose a patch to the guide's JSON; the patch is validated against the live DOM before it is applied.

This is distinct from the `<assistant>`-tag feature (see [`ASSISTANT_INTEGRATION.md`](ASSISTANT_INTEGRATION.md)), which makes _authored content_ customizable. AI auto-heal _repairs a broken step at runtime_.

The whole flow is **dark by default** — see [Enablement](#enablement).

## Table of contents

- [Enablement](#enablement)
- [End-to-end flow](#end-to-end-flow)
- [Event contract](#event-contract)
- [Patch wire format](#patch-wire-format)
- [Confidence gate](#confidence-gate)
- [Module map](#module-map)
- [Testing](#testing)

## Enablement

The feature is gated by **two conditions that must both hold**, expressed by `useAiFixEnabled()` (`src/integrations/assistant-integration/use-ai-fix-enabled.ts`):

1. **Assistant available** — `useIsAssistantAvailable()` (the Grafana Assistant is reachable in this instance).
2. **Admin opt-in** — the `enableAiAutoHeal` plugin setting is on.

`DEFAULT_ENABLE_AI_AUTO_HEAL = false` (`src/constants.ts`), flowed through `getConfigWithDefaults`, so the AI write path is **off until an admin explicitly opts in per tenant**. The toggle lives in the plugin config UI under "AI auto-heal" (`src/components/AppConfig/InteractiveFeatures.tsx`, testId `config-interactive-enable-ai-auto-heal`): _"Enable AI-powered 'Fix this' on failing steps."_ When on, the UI shows a "Write path — opt-in" warning that accepted suggestions mutate the in-memory guide JSON for the user's session.

Defense in depth: the buttons read `useAiFixEnabled()` (render nothing when off), **and** the orchestrator re-checks both gates inside its request handler, so a stray dispatched event is dropped even if a button were shown in error. No PR in this feature flips the default — activation is always an opt-in admin toggle.

## End-to-end flow

1. **Dispatch.** A failing step renders a shared `<AiFixButton>` (`src/components/interactive-tutorial/ai-fix-button.tsx`). On click, `dispatchAiFixRequest(detail)` reports `UserInteraction.AiFixAccepted` and dispatches the `pathfinder-ai-fix-request` window event. There are five sites: two in `interactive-step.tsx` (lazy-scroll runtime + pre-execution requirement), one in `interactive-multi-step.tsx` (runtime substep), two in `interactive-guided.tsx` (pre-execution + runtime substep).
2. **Listen.** `AiFixOrchestrator` (`src/components/docs-panel/AiFixOrchestrator.tsx`), lazy-mounted in `docs-panel.tsx`, listens for the event. It reports `AiFixOffered`, re-checks the two gates, and starts `GlobalInteractionBlocker` ad-hoc blocking so the user can't race the assistant.
3. **Build context.** It materializes canonical step ids onto the guide JSON (`materializeStepIdsInJson`), extracts the failing step's instruction text (`extractStepContent`), and collects a bounded DOM hint (`collectDomContext`).
4. **Generate.** `useAiFixGeneration` (`useAiFixGeneration.hook.ts`) calls the Grafana Assistant with a system prompt + the assembled context.
5. **Parse.** `parseAssistantPatch` strips code fences, detects the "no confident fix" / `<unchanged>` sentinels (before schema validation — the sentinel contains characters the deny-list would reject), then validates against the patch schema.
6. **Gate.** `evaluatePatchConfidence(patch)` ([below](#confidence-gate)) verifies the proposed selector resolves on the live page.
7. **Apply.** `applyPatchToGuide(rawGuideJson, patch)` (`apply-ai-fix-patch.ts`) re-validates, deep-clones, mutates by id, and re-validates the result. The orchestrator calls `onPatchApplied(tabId, newGuideJson)`, which writes the patched JSON back into the active tab.
8. **Re-check.** `ContentRenderer`'s memoization on `content.content` remounts the failing step, and the step-checker's `refTarget` recheck re-runs against the new selector. The orchestrator reports `AiFixApplied` (or `AiFixFailed`), stops the blocker, and surfaces a success/warning toast.

Analytics events (`UserInteraction` in `src/lib/analytics.ts`): `AiFixOffered`, `AiFixAccepted`, `AiFixApplied`, `AiFixFailed`.

## Event contract

The producer (`ai-fix-button.tsx`) and consumer (`AiFixOrchestrator.tsx`) share a single source of truth, `src/integrations/assistant-integration/ai-fix-event.ts`:

```ts
export const AI_FIX_REQUEST_EVENT = 'pathfinder-ai-fix-request';

export interface AiFixRequestDetail {
  stepId?: string;
  renderedStepId?: string;
  refTarget?: string;
  action?: string;
  containerInfo?: {
    containerId: string;
    containerKind: 'multistep' | 'guided';
    subStepIndex: number;
  };
}
```

`containerInfo` is present only for sub-step failures inside a multistep/guided container; its `containerId` is the canonical step id of the container, and `subStepIndex` is the 0-based index of the failing internal action.

## Patch wire format

Defined as a Zod discriminated union in `src/integrations/assistant-integration/ai-fix-patch.schema.ts`. The assistant must return exactly one of:

| Variant                  | Targets                                   | Key fields                                                  |
| ------------------------ | ----------------------------------------- | ----------------------------------------------------------- |
| `selector-patch`         | a top-level interactive block             | `targetStepId`, `newReftarget`, `rationale?`                |
| `substep-selector-patch` | an action inside a multistep/guided block | `containerId`, `subStepIndex`, `newReftarget`, `rationale?` |
| `prepend-step`           | inserts a new step before the failing one | `beforeStepId`, `newStep`, `rationale?`                     |

`newStep` is validated by the authoritative `JsonInteractiveBlockSchema`. Every selector goes through `SafeSelectorSchema`: max 512 chars and a deny-list rejecting `<`, `>`, backtick, `${`, and the `javascript:` / `data:` / `vbscript:` URL schemes (prefix check — attribute matches like `a[href^="javascript:"]` still pass).

## Confidence gate

`evaluatePatchConfidence(patch)` (`src/integrations/assistant-integration/ai-fix-confidence.ts`) decides whether a patch may be written into the guide. It accepts **iff the proposed selector resolves to ≥ 1 element in the live DOM**, using the same `resolveSelector` → `querySelectorAllEnhanced` pipeline the interactive engine uses at execution time. Outcomes:

- **prepend-step without a reftarget** → accept (purely instructional, no DOM target to verify).
- **no selector to verify** / **invalid CSS** / **zero matches** → reject (the orchestrator surfaces a warning toast and reports `AiFixFailed`).

There is no token/similarity heuristic — a correct fix often shares no tokens with the failing selector.

## Module map

| File                                                            | Role                                                            |
| --------------------------------------------------------------- | --------------------------------------------------------------- |
| `integrations/assistant-integration/ai-fix-event.ts`            | Event name + `AiFixRequestDetail` contract                      |
| `integrations/assistant-integration/use-ai-fix-enabled.ts`      | `useAiFixEnabled()` dual gate                                   |
| `integrations/assistant-integration/ai-fix-patch.schema.ts`     | Patch wire-format schema + `SafeSelectorSchema`                 |
| `integrations/assistant-integration/useAiFixGeneration.hook.ts` | Assistant call, prompt building, sentinel + schema parsing      |
| `integrations/assistant-integration/ai-fix-dom-context.ts`      | `collectDomContext` + DOM candidate scoring helpers             |
| `integrations/assistant-integration/ai-fix-step-content.ts`     | `extractStepContent` (failing step's instruction text)          |
| `integrations/assistant-integration/ai-fix-step-id.ts`          | `materializeStepIds` / `materializeStepIdsInJson` canonical ids |
| `integrations/assistant-integration/ai-fix-confidence.ts`       | `evaluatePatchConfidence` live-DOM gate                         |
| `integrations/assistant-integration/apply-ai-fix-patch.ts`      | `applyPatchToGuide` (validate → mutate → re-validate)           |
| `components/docs-panel/AiFixOrchestrator.tsx`                   | Listener; orchestrates generate → gate → apply; lazy-mounted    |
| `components/interactive-tutorial/ai-fix-button.tsx`             | Shared `<AiFixButton>` + `dispatchAiFixRequest`                 |
| `requirements-manager/step-checker.hook.ts`                     | `requiresDomElement` signal + `refTarget` recheck               |

## Testing

Each module has a co-located unit suite (`*.test.ts(x)`) under the same directory: the schema deny-list, the pure apply paths, the generation hook's sentinel-before-schema ordering, the DOM-context helpers, the confidence gate (live-match / zero-match / prepend-without-reftarget), the orchestrator's gate/apply/error effects, the shared button's dispatch + analytics, and `useAiFixEnabled`'s dual gate. There is no E2E for this flow.
