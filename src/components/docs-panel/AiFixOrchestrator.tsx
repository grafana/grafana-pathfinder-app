/**
 * AiFixOrchestrator — glue between the "Ask AI to fix" button in interactive
 * steps and the docs-panel Scene model.
 *
 * Listens for `pathfinder-ai-fix-request` events emitted by
 * `interactive-step.tsx` / `interactive-guided.tsx` when a user invokes the
 * AI fallback. On a request:
 *   1. Read the active tab's guide JSON.
 *   2. Start the global ad-hoc blocker so the user can't race the assistant.
 *   3. Optionally capture a viewport screenshot.
 *   4. Call the Grafana Assistant via `useAiFixGeneration`.
 *   5. On a validated patch, apply it to the tab content and `setState`.
 *      ContentRenderer's existing memoization on `content.content` causes
 *      the failing step to remount and re-check.
 *   6. Stop the blocker; report success/failure analytics.
 *
 * Renders nothing.
 */

import { useEffect, useRef } from 'react';

import { reportAppInteraction, UserInteraction } from '../../lib/analytics';
import { useAiFixGeneration } from '../../integrations/assistant-integration/useAiFixGeneration.hook';
import { applyPatchToGuide } from '../../integrations/assistant-integration/apply-ai-fix-patch';
import { synthesizeStepIdsInJson } from '../../docs-retrieval';
import { GlobalInteractionBlocker } from '../../interactive-engine';
import type { LearningJourneyTab } from '../../types/content-panel.types';

interface AiFixRequestDetail {
  stepId?: string;
  renderedStepId?: string;
  refTarget?: string;
  action?: string;
  /**
   * Container address for sub-step failures (multistep / guided containers).
   * When present the orchestrator forwards a `containerInfo` payload to the
   * assistant so it picks the `substep-selector-patch` variant.
   */
  containerInfo?: {
    containerId: string;
    containerKind: 'multistep' | 'guided';
    subStepIndex: number;
  };
}

interface AiFixOrchestratorProps {
  /** The currently-active tab whose guide JSON we'll patch on success. */
  activeTab: LearningJourneyTab | null;
  /** Callback to write the patched guide JSON back into the active tab. */
  onPatchApplied: (tabId: string, newGuideJson: string) => void;
}

/**
 * Collect a short DOM hint about what's currently visible. Bounded so we
 * don't ship a full DOM dump to the assistant prompt.
 */
function collectDomHint(): string {
  if (typeof document === 'undefined') {
    return '';
  }
  const lines: string[] = [];
  const headings = Array.from(document.querySelectorAll('h1,h2,h3'))
    .map((el) => (el.textContent ?? '').trim())
    .filter(Boolean)
    .slice(0, 8);
  if (headings.length > 0) {
    lines.push(`Headings: ${headings.join(' | ')}`);
  }
  const buttons = Array.from(document.querySelectorAll('button,[role="button"]'))
    .map((el) => (el.textContent ?? '').trim())
    .filter((t) => t.length > 0 && t.length < 60)
    .slice(0, 16);
  if (buttons.length > 0) {
    lines.push(`Buttons: ${buttons.join(' | ')}`);
  }
  const navLinks = Array.from(document.querySelectorAll('nav a, [data-testid*="nav"] a'))
    .map((el) => (el.textContent ?? '').trim())
    .filter(Boolean)
    .slice(0, 12);
  if (navLinks.length > 0) {
    lines.push(`Nav: ${navLinks.join(' | ')}`);
  }
  return lines.join('\n');
}

function AiFixOrchestrator({ activeTab, onPatchApplied }: AiFixOrchestratorProps): null {
  const contentKey = activeTab?.id ?? 'pathfinder-ai-fix-orchestrator';
  const { generate, patch, error, reset, isAssistantAvailable } = useAiFixGeneration(contentKey);

  // The active request we're servicing. Cleared when patch lands or errors.
  const pendingRequestRef = useRef<AiFixRequestDetail | null>(null);
  // Keep the latest tab in a ref so the request handler can read it without
  // re-binding the listener on every render (which would drop in-flight
  // requests). Sync the ref in an effect — never during render.
  const activeTabRef = useRef<LearningJourneyTab | null>(activeTab);
  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  // Listen for AI fix requests.
  useEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent<AiFixRequestDetail>).detail;
      console.warn('[AiFixOrchestrator] request received', detail);
      const tab = activeTabRef.current;
      if (!tab?.content?.content) {
        console.warn('[AiFixOrchestrator] no active tab content; ignoring AI fix request');
        return;
      }
      if (!isAssistantAvailable) {
        console.warn('[AiFixOrchestrator] assistant unavailable; cannot run AI fix');
        reportAppInteraction(UserInteraction.AiFixFailed, { reason: 'assistant_unavailable' });
        return;
      }
      if (pendingRequestRef.current) {
        console.warn('[AiFixOrchestrator] another request already in flight; ignoring');
        return;
      }
      pendingRequestRef.current = detail;
      reportAppInteraction(UserInteraction.AiFixOffered, {
        step_id: detail.stepId ?? '',
        rendered_step_id: detail.renderedStepId ?? '',
      });

      GlobalInteractionBlocker.getInstance().startAdHocBlocking('Asking Grafana Assistant for a fix…');
      console.warn('[AiFixOrchestrator] blocker started, collecting DOM hint');

      // The renderer's `parseJsonGuide` synthesized runtime ids on its
      // in-memory tree, so dispatched event ids already reference the
      // augmented form. Re-run synthesis on the raw `tab.content.content`
      // string so the assistant + apply path see the same ids.
      const augmentedJson = synthesizeStepIdsInJson(tab.content.content);
      const domHint = collectDomHint();

      // NOTE: screenshot capture is intentionally disabled in v1. Embedding
      // a base64 image in the prompt was causing the assistant streaming
      // call to fail ("No final output received from streaming response") —
      // the SDK doesn't read markdown data-URLs as images anyway. The
      // structured context (guide JSON + DOM hint + URL via
      // useProvidePageContext) is enough signal for the model.
      console.warn('[AiFixOrchestrator] calling generate()', {
        guideJsonChars: augmentedJson.length,
        domHintChars: domHint.length,
        containerInfo: detail.containerInfo,
      });

      await generate({
        guideJson: augmentedJson,
        failingStepId: detail.stepId ?? '',
        failingReftarget: detail.refTarget ?? '',
        failingAction: detail.action ?? '',
        domHint,
        containerInfo: detail.containerInfo,
      });
      console.warn('[AiFixOrchestrator] generate() resolved (will see patch or error log next)');
    };

    window.addEventListener('pathfinder-ai-fix-request', handler);
    return () => window.removeEventListener('pathfinder-ai-fix-request', handler);
  }, [generate, isAssistantAvailable]);

  // Apply a successfully-validated patch.
  useEffect(() => {
    if (!patch) {
      return;
    }
    console.warn('[AiFixOrchestrator] patch arrived from assistant', patch);
    const tab = activeTabRef.current;
    const request = pendingRequestRef.current;
    if (!tab?.content?.content || !request) {
      console.warn('[AiFixOrchestrator] missing tab content or pending request when patch arrived; aborting');
      pendingRequestRef.current = null;
      GlobalInteractionBlocker.getInstance().stopAdHocBlocking();
      reset();
      return;
    }

    // Apply against the synthesized form so the patch's ids resolve.
    const result = applyPatchToGuide(synthesizeStepIdsInJson(tab.content.content), patch);
    if (result.ok) {
      console.warn('[AiFixOrchestrator] patch applied; writing back to tab content', {
        tabId: tab.id,
        newJsonLength: result.newGuideJson.length,
      });
      onPatchApplied(tab.id, result.newGuideJson);
      reportAppInteraction(UserInteraction.AiFixApplied, {
        step_id: request.stepId ?? '',
        patch_type: patch.type,
      });
    } else {
      console.warn('[AiFixOrchestrator] patch FAILED to apply:', result.error);
      reportAppInteraction(UserInteraction.AiFixFailed, {
        step_id: request.stepId ?? '',
        reason: result.error,
      });
    }

    pendingRequestRef.current = null;
    GlobalInteractionBlocker.getInstance().stopAdHocBlocking();
    reset();
  }, [patch, onPatchApplied, reset]);

  // Handle assistant / parse errors.
  useEffect(() => {
    if (!error) {
      return;
    }
    console.warn('[AiFixOrchestrator] assistant or parse error', error);
    const request = pendingRequestRef.current;
    reportAppInteraction(UserInteraction.AiFixFailed, {
      step_id: request?.stepId ?? '',
      reason: error.message.slice(0, 200),
    });
    pendingRequestRef.current = null;
    GlobalInteractionBlocker.getInstance().stopAdHocBlocking();
    reset();
  }, [error, reset]);

  return null;
}

// Default export for `React.lazy` consumption from docs-panel. The lazy
// import is what keeps `@grafana/assistant` out of the docs-panel module
// init chain — important for jest, where the assistant package's runtime
// initialization throws "Class extends value undefined".
export default AiFixOrchestrator;
