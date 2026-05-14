/**
 * useAiFixGeneration
 *
 * Thin wrapper over `useAssistantGeneration` that asks the Grafana Assistant
 * for an AI-auto-heal patch when a guide step's `exists-reftarget`
 * requirement has failed and no deterministic fix-registry handler matched.
 *
 * The assistant is given:
 * - The full guide JSON (so it understands the surrounding flow).
 * - The failing step's id, action, and current `reftarget`.
 * - A short DOM hint (nearby visible text, headings) collected by the caller.
 * - Optionally a viewport screenshot as a markdown image (data URL).
 *
 * On completion we strip markdown code fences, parse the JSON, and validate
 * via `AiFixPatchSchema`. The hook surfaces `patch` (validated) or `error`
 * (parse / schema / assistant failure). Either way `isGenerating` flips back
 * to `false`.
 *
 * Dev mode (`useMockInlineAssistant`) returns a canned selector patch so the
 * UI flow can be tested without a real assistant backend.
 */

import { useCallback, useState } from 'react';

import { useAssistantGeneration, cleanAssistantResponse } from './useAssistantGeneration.hook';
import { AiFixPatchSchema, type AiFixPatch } from './ai-fix-patch.schema';

export interface AiFixGenerationInput {
  /** Stringified JSON of the running guide (canonical wire format). */
  guideJson: string;
  /** Stable id of the failing step (caller must ensure this is set). */
  failingStepId: string;
  /** Current `reftarget` selector that missed. */
  failingReftarget: string;
  /** The step's `action` (button | formfill | highlight | …) for context. */
  failingAction: string;
  /**
   * Short hint about what's visible near where the selector should have
   * matched — typically the headings + button labels currently on screen.
   * Bounded by the caller (we don't want to ship a full DOM dump).
   */
  domHint: string;
  /**
   * Optional viewport screenshot as a `data:image/jpeg;base64,…` URL.
   * Embedded as a markdown image; whether the backend model uses it
   * depends on the deployed assistant model's multimodal capability.
   */
  screenshotDataUrl?: string;
  /**
   * Set when the failing step is an internal action inside a `multistep` /
   * `guided` container. The container id + index are the only way to address
   * anonymous sub-steps. When present, the prompt steers the assistant to
   * return a `substep-selector-patch` instead of `selector-patch`.
   */
  containerInfo?: {
    containerId: string;
    containerKind: 'multistep' | 'guided';
    subStepIndex: number;
  };
}

export interface UseAiFixGenerationReturn {
  /** Whether the assistant is available in this Grafana instance. */
  isAssistantAvailable: boolean;
  /** Kick off a fix-generation request. Resolves when generation completes. */
  generate: (input: AiFixGenerationInput) => Promise<void>;
  /** True while the assistant is producing the patch. */
  isGenerating: boolean;
  /** Validated patch, or `null` until a generation completes successfully. */
  patch: AiFixPatch | null;
  /** Parse / schema / assistant error, or `null` on success. */
  error: Error | null;
  /** Clear `patch` and `error`. Used before retrying. */
  reset: () => void;
}

const ORIGIN = 'grafana-pathfinder-app/ai-fix';

const SYSTEM_PROMPT = `You are repairing a broken interactive guide step in Grafana Pathfinder. The user clicked an "Ask AI to fix" button after a CSS selector failed to find its target element.

Return EXACTLY ONE JSON object matching one of these shapes (no prose, no explanation, no code fences):

selector-patch — failing step is a top-level interactive block; its reftarget needs replacing:
{ "type": "selector-patch", "targetStepId": "<id>", "newReftarget": "<safe-css-or-data-testid>", "rationale": "<one short sentence>" }

substep-selector-patch — failing step is an internal action inside a multistep / guided container. Use the container's id and the action's 0-based index:
{ "type": "substep-selector-patch", "containerId": "<id>", "subStepIndex": <int>, "newReftarget": "<safe-css>", "rationale": "<one short sentence>" }

prepend-step — a new top-level step must run before the failing one to set up the missing UI state:
{ "type": "prepend-step", "beforeStepId": "<id>", "newStep": { "type": "interactive", "action": "<action>", "reftarget": "<safe-css>", "content": "<markdown>", … }, "rationale": "<one short sentence>" }

RULES:
1. Only ever return one patch. Pick the simplest viable fix.
2. The new selector MUST be a real CSS selector or data-testid string. No HTML tags, no template literals, no javascript:/data: URLs. Max 512 chars.
3. Prefer data-testid when present in the DOM hint.
4. When the request includes container info, you MUST use "substep-selector-patch" (not "selector-patch") and address the failing step via containerId + subStepIndex.
5. For prepend-step, the newStep must conform to the interactive block schema: type="interactive", an action verb, reftarget (unless action is "noop" or "popout"), and content (markdown shown to the user). Prepend-step is NOT supported for substep failures in v1.
6. If you cannot determine a fix with confidence, return { "type": "selector-patch", "targetStepId": "<id>", "newReftarget": "<unchanged>", "rationale": "no confident fix" } and the runtime will surface a failure to the user — DO NOT invent a selector.`;

export function buildUserPrompt(input: AiFixGenerationInput): string {
  const parts: string[] = [];
  parts.push('A guide step failed to find its DOM target. Suggest a fix.');
  parts.push('');
  if (input.containerInfo) {
    parts.push(`Failing step is an internal action inside a ${input.containerInfo.containerKind} container.`);
    parts.push(`Container id: ${input.containerInfo.containerId}`);
    parts.push(`Sub-step index (0-based): ${input.containerInfo.subStepIndex}`);
    parts.push('Use the "substep-selector-patch" variant.');
    parts.push('');
  }
  parts.push(`Failing step id: ${input.failingStepId}`);
  parts.push(`Action: ${input.failingAction}`);
  parts.push(`Current reftarget (did not match): ${input.failingReftarget}`);
  parts.push('');
  parts.push('Visible DOM hint:');
  parts.push(input.domHint || '(none collected)');
  parts.push('');
  parts.push('Full guide JSON:');
  parts.push(input.guideJson);
  if (input.screenshotDataUrl) {
    parts.push('');
    parts.push('Viewport screenshot:');
    parts.push(`![viewport](${input.screenshotDataUrl})`);
  }
  return parts.join('\n');
}

/**
 * Parse the assistant's text response into a validated patch.
 *
 * Exposed for testing; the hook calls it from `onComplete`.
 */
export function parseAssistantPatch(text: string): { ok: true; patch: AiFixPatch } | { ok: false; error: Error } {
  const cleaned = cleanAssistantResponse(text);
  let raw: unknown;
  try {
    raw = JSON.parse(cleaned);
  } catch (e) {
    return {
      ok: false,
      error: new Error(`AI fix: response was not valid JSON (${e instanceof Error ? e.message : 'parse error'})`),
    };
  }
  const parsed = AiFixPatchSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: new Error(`AI fix: response failed schema check (${parsed.error.issues[0]?.message ?? 'unknown'})`),
    };
  }
  return { ok: true, patch: parsed.data };
}

export function useAiFixGeneration(contentKey: string): UseAiFixGenerationReturn {
  const { isAssistantAvailable, generate: rawGenerate } = useAssistantGeneration({
    contentKey,
    assistantId: 'ai-fix',
  });

  const [patch, setPatch] = useState<AiFixPatch | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const reset = useCallback(() => {
    setPatch(null);
    setError(null);
  }, []);

  const generate = useCallback(
    async (input: AiFixGenerationInput): Promise<void> => {
      setPatch(null);
      setError(null);
      setIsGenerating(true);

      await rawGenerate({
        origin: ORIGIN,
        prompt: buildUserPrompt(input),
        systemPrompt: SYSTEM_PROMPT,
        onComplete: (text) => {
          const result = parseAssistantPatch(text);
          if (result.ok) {
            setPatch(result.patch);
          } else {
            setError(result.error);
          }
          setIsGenerating(false);
        },
        onError: (err) => {
          setError(err);
          setIsGenerating(false);
        },
      });
    },
    [rawGenerate]
  );

  return { isAssistantAvailable, generate, isGenerating, patch, error, reset };
}
