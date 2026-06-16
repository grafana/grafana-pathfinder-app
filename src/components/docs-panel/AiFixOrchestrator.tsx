import { useCallback, useEffect, useMemo, useRef } from 'react';

import { AppEvents, usePluginContext } from '@grafana/data';
import { getAppEvents } from '@grafana/runtime';

import { getConfigWithDefaults } from '../../constants';
import { evaluatePatchConfidence } from '../../integrations/assistant-integration/ai-fix-confidence';
import { collectDomContext, tagFromSelector } from '../../integrations/assistant-integration/ai-fix-dom-context';
import { AI_FIX_REQUEST_EVENT, type AiFixRequestDetail } from '../../integrations/assistant-integration/ai-fix-event';
import { materializeStepIdsInJson } from '../../integrations/assistant-integration/ai-fix-step-id';
import { extractStepContent } from '../../integrations/assistant-integration/ai-fix-step-content';
import { applyPatchToGuide } from '../../integrations/assistant-integration/apply-ai-fix-patch';
import { useAiFixGeneration } from '../../integrations/assistant-integration/useAiFixGeneration.hook';
import { GlobalInteractionBlocker } from '../../interactive-engine';
import { reportAppInteraction, UserInteraction } from '../../lib/analytics';
import type { LearningJourneyTab } from '../../types/content-panel.types';

// Safety net: the assistant can resolve without a patch or error, which would wedge the gate forever.
const AI_FIX_REQUEST_TIMEOUT_MS = 30_000;

function publishToast(severity: 'success' | 'warning', title: string, body?: string) {
  try {
    const event = severity === 'success' ? AppEvents.alertSuccess : AppEvents.alertWarning;
    getAppEvents().publish({ type: event.name, payload: body ? [title, body] : [title] });
  } catch {
    // Non-Grafana host (jsdom): a missing toast is harmless.
  }
}

interface PendingAiFixRequest {
  detail: AiFixRequestDetail;
  tabId: string;
  guideJson: string;
}

interface AiFixOrchestratorProps {
  activeTab: LearningJourneyTab | null;
  onPatchApplied: (tabId: string, newGuideJson: string) => void;
}

function AiFixOrchestrator({ activeTab, onPatchApplied }: AiFixOrchestratorProps): null {
  const contentKey = activeTab?.id ?? 'pathfinder-ai-fix-orchestrator';
  const { generate, patch, error, reset, isAssistantAvailable } = useAiFixGeneration(contentKey);

  const pluginContext = usePluginContext();
  const aiAutoHealEnabled = useMemo(
    () => getConfigWithDefaults(pluginContext?.meta?.jsonData || {}).enableAiAutoHeal,
    [pluginContext?.meta?.jsonData]
  );

  const pendingRequestRef = useRef<PendingAiFixRequest | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest tab via ref so the listener isn't re-bound each render (would drop in-flight requests).
  const activeTabRef = useRef<LearningJourneyTab | null>(activeTab);
  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  const clearPending = useCallback(() => {
    pendingRequestRef.current = null;
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    GlobalInteractionBlocker.getInstance().stopAdHocBlocking();
    reset();
  }, [reset]);

  useEffect(() => () => clearPending(), [clearPending]);

  useEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent<AiFixRequestDetail>).detail;
      const tab = activeTabRef.current;
      if (!tab?.content?.content) {
        return;
      }
      if (!aiAutoHealEnabled) {
        reportAppInteraction(UserInteraction.AiFixFailed, { reason: 'feature_flag_disabled' });
        return;
      }
      if (!isAssistantAvailable) {
        reportAppInteraction(UserInteraction.AiFixFailed, { reason: 'assistant_unavailable' });
        return;
      }
      if (pendingRequestRef.current) {
        return;
      }
      pendingRequestRef.current = { detail, tabId: tab.id, guideJson: tab.content.content };
      reportAppInteraction(UserInteraction.AiFixOffered, {
        step_id: detail.stepId ?? '',
        rendered_step_id: detail.renderedStepId ?? '',
      });

      GlobalInteractionBlocker.getInstance().startAdHocBlocking('Asking Grafana Assistant for a fix…');
      timeoutRef.current = setTimeout(() => {
        if (!pendingRequestRef.current) {
          return;
        }
        reportAppInteraction(UserInteraction.AiFixFailed, { step_id: detail.stepId ?? '', reason: 'timeout' });
        publishToast('warning', "AI couldn't fix this step", 'The request timed out.');
        clearPending();
      }, AI_FIX_REQUEST_TIMEOUT_MS);

      // Materialize canonical ids so the assistant + extraction see the ids a component dispatched.
      const augmentedJson = materializeStepIdsInJson(tab.content.content);
      const domHint = collectDomContext(detail.refTarget ?? '');
      const failingStepContent = extractStepContent(augmentedJson, detail.stepId ?? '', detail.containerInfo);
      const failingTag = tagFromSelector(detail.refTarget ?? '');

      await generate({
        guideJson: augmentedJson,
        failingStepId: detail.stepId ?? '',
        failingReftarget: detail.refTarget ?? '',
        failingAction: detail.action ?? '',
        failingStepContent: failingStepContent || undefined,
        failingTag,
        domHint,
        containerInfo: detail.containerInfo,
      });
    };

    window.addEventListener(AI_FIX_REQUEST_EVENT, handler);
    return () => window.removeEventListener(AI_FIX_REQUEST_EVENT, handler);
  }, [generate, isAssistantAvailable, aiAutoHealEnabled, clearPending]);

  useEffect(() => {
    if (!patch) {
      return;
    }
    // Use the tab/guide captured at acceptance — the user may have switched tabs mid-flight.
    const request = pendingRequestRef.current;
    if (!request) {
      clearPending();
      return;
    }

    const confidence = evaluatePatchConfidence(patch);
    if (!confidence.ok) {
      reportAppInteraction(UserInteraction.AiFixFailed, {
        step_id: request.detail.stepId ?? '',
        reason: `low-confidence: ${confidence.reason}`,
      });
      publishToast('warning', "AI couldn't find a confident fix", confidence.reason);
      clearPending();
      return;
    }

    // applyPatchToGuide materializes ids internally — pass the raw guide string.
    const result = applyPatchToGuide(request.guideJson, patch);
    if (result.ok) {
      onPatchApplied(request.tabId, result.newGuideJson);
      reportAppInteraction(UserInteraction.AiFixApplied, {
        step_id: request.detail.stepId ?? '',
        patch_type: patch.type,
      });
      publishToast(
        'success',
        'AI updated this step',
        patch.rationale ? patch.rationale : 'A new selector was applied; the requirement will re-check now.'
      );
    } else {
      reportAppInteraction(UserInteraction.AiFixFailed, {
        step_id: request.detail.stepId ?? '',
        reason: result.error,
      });
      publishToast('warning', "AI couldn't update this step", result.error);
    }

    clearPending();
  }, [patch, onPatchApplied, clearPending]);

  useEffect(() => {
    if (!error) {
      return;
    }
    const request = pendingRequestRef.current;
    reportAppInteraction(UserInteraction.AiFixFailed, {
      step_id: request?.detail.stepId ?? '',
      reason: error.message.slice(0, 200),
    });
    publishToast('warning', "AI couldn't fix this step", error.message.slice(0, 200));
    clearPending();
  }, [error, clearPending]);

  return null;
}

// Lazy default export keeps @grafana/assistant out of the docs-panel init chain
// (its runtime init throws "Class extends value undefined" under jest).
export default AiFixOrchestrator;
