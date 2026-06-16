import React from 'react';
import { render, act, waitFor } from '@testing-library/react';

import { usePluginContext } from '@grafana/data';
import { getAppEvents } from '@grafana/runtime';

import AiFixOrchestrator from './AiFixOrchestrator';
import { reportAppInteraction, UserInteraction } from '../../lib/analytics';
import { useAiFixGeneration } from '../../integrations/assistant-integration/useAiFixGeneration.hook';
import { evaluatePatchConfidence } from '../../integrations/assistant-integration/ai-fix-confidence';
import { applyPatchToGuide } from '../../integrations/assistant-integration/apply-ai-fix-patch';
import { AI_FIX_REQUEST_EVENT } from '../../integrations/assistant-integration/ai-fix-event';
import type { LearningJourneyTab } from '../../types/content-panel.types';

jest.mock('@grafana/data', () => ({
  usePluginContext: jest.fn(),
  AppEvents: { alertSuccess: { name: 'alert-success' }, alertWarning: { name: 'alert-warning' } },
}));
jest.mock('@grafana/runtime', () => ({ getAppEvents: jest.fn() }));
jest.mock('../../lib/analytics', () => ({
  reportAppInteraction: jest.fn(),
  UserInteraction: {
    AiFixOffered: 'ai_fix_offered',
    AiFixApplied: 'ai_fix_applied',
    AiFixFailed: 'ai_fix_failed',
  },
}));
jest.mock('../../constants', () => ({
  getConfigWithDefaults: (jsonData: Record<string, unknown> | undefined) => ({
    enableAiAutoHeal: !!jsonData?.enableAiAutoHeal,
  }),
}));
jest.mock('../../interactive-engine', () => ({
  GlobalInteractionBlocker: {
    getInstance: () => ({ startAdHocBlocking: jest.fn(), stopAdHocBlocking: jest.fn() }),
  },
}));
jest.mock('../../integrations/assistant-integration/ai-fix-dom-context', () => ({
  collectDomContext: jest.fn(() => ''),
  tagFromSelector: jest.fn(() => undefined),
}));
jest.mock('../../integrations/assistant-integration/ai-fix-step-content', () => ({
  extractStepContent: jest.fn(() => ''),
}));
jest.mock('../../integrations/assistant-integration/ai-fix-step-id', () => ({
  materializeStepIdsInJson: (json: string) => json,
}));
jest.mock('../../integrations/assistant-integration/ai-fix-confidence', () => ({
  evaluatePatchConfidence: jest.fn(() => ({ ok: true })),
}));
jest.mock('../../integrations/assistant-integration/apply-ai-fix-patch', () => ({
  applyPatchToGuide: jest.fn(() => ({ ok: true, newGuideJson: '{"blocks":[],"patched":true}' })),
}));
jest.mock('../../integrations/assistant-integration/useAiFixGeneration.hook', () => ({
  useAiFixGeneration: jest.fn(),
}));

const TAB = { id: 'tab1', content: { content: '{"blocks":[]}' } } as unknown as LearningJourneyTab;
const OTHER_TAB = { id: 'tab2', content: { content: '{"blocks":["other"]}' } } as unknown as LearningJourneyTab;
const SELECTOR_PATCH = {
  type: 'selector-patch',
  targetStepId: 's1',
  newReftarget: '[data-testid="ok"]',
  rationale: 'use the live testid',
} as const;

const publish = jest.fn();
const generate = jest.fn();
const reset = jest.fn();
let hookReturn: ReturnType<typeof useAiFixGeneration>;

function dispatchRequest(detail: Record<string, unknown> = { stepId: 's1', refTarget: '.gone', action: 'button' }) {
  return act(async () => {
    window.dispatchEvent(new CustomEvent(AI_FIX_REQUEST_EVENT, { detail }));
  });
}

function setFlag(enabled: boolean) {
  (usePluginContext as jest.Mock).mockReturnValue({ meta: { jsonData: { enableAiAutoHeal: enabled } } });
}

beforeEach(() => {
  jest.clearAllMocks();
  (getAppEvents as jest.Mock).mockReturnValue({ publish });
  setFlag(true);
  hookReturn = { isAssistantAvailable: true, generate, isGenerating: false, patch: null, error: null, reset };
  (useAiFixGeneration as jest.Mock).mockImplementation(() => hookReturn);
  (evaluatePatchConfidence as jest.Mock).mockReturnValue({ ok: true });
  (applyPatchToGuide as jest.Mock).mockReturnValue({ ok: true, newGuideJson: '{"blocks":[],"patched":true}' });
});

describe('AiFixOrchestrator', () => {
  it('renders nothing', () => {
    const { container } = render(<AiFixOrchestrator activeTab={TAB} onPatchApplied={jest.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('drops the request when the admin flag is off (dark landing)', async () => {
    setFlag(false);
    render(<AiFixOrchestrator activeTab={TAB} onPatchApplied={jest.fn()} />);
    await dispatchRequest();
    expect(generate).not.toHaveBeenCalled();
    expect(reportAppInteraction).toHaveBeenCalledWith(
      UserInteraction.AiFixFailed,
      expect.objectContaining({ reason: 'feature_flag_disabled' })
    );
  });

  it('drops the request when the assistant is unavailable', async () => {
    hookReturn = { ...hookReturn, isAssistantAvailable: false };
    render(<AiFixOrchestrator activeTab={TAB} onPatchApplied={jest.fn()} />);
    await dispatchRequest();
    expect(generate).not.toHaveBeenCalled();
    expect(reportAppInteraction).toHaveBeenCalledWith(
      UserInteraction.AiFixFailed,
      expect.objectContaining({ reason: 'assistant_unavailable' })
    );
  });

  it('calls generate with the failing step details when enabled and available', async () => {
    render(<AiFixOrchestrator activeTab={TAB} onPatchApplied={jest.fn()} />);
    await dispatchRequest({ stepId: 's1', refTarget: '.gone', action: 'button' });
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        guideJson: TAB.content!.content,
        failingStepId: 's1',
        failingReftarget: '.gone',
        failingAction: 'button',
      })
    );
    expect(reportAppInteraction).toHaveBeenCalledWith(UserInteraction.AiFixOffered, expect.any(Object));
  });

  it('applies a confident patch back into the tab and reports success', async () => {
    const onPatchApplied = jest.fn();
    const { rerender } = render(<AiFixOrchestrator activeTab={TAB} onPatchApplied={onPatchApplied} />);
    await dispatchRequest();

    hookReturn = { ...hookReturn, patch: SELECTOR_PATCH };
    rerender(<AiFixOrchestrator activeTab={TAB} onPatchApplied={onPatchApplied} />);

    await waitFor(() => expect(onPatchApplied).toHaveBeenCalledWith('tab1', '{"blocks":[],"patched":true}'));
    expect(reportAppInteraction).toHaveBeenCalledWith(
      UserInteraction.AiFixApplied,
      expect.objectContaining({ patch_type: 'selector-patch' })
    );
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'alert-success' }));
  });

  it('rejects a low-confidence patch without writing it back', async () => {
    (evaluatePatchConfidence as jest.Mock).mockReturnValue({ ok: false, reason: 'no live match' });
    const onPatchApplied = jest.fn();
    const { rerender } = render(<AiFixOrchestrator activeTab={TAB} onPatchApplied={onPatchApplied} />);
    await dispatchRequest();

    hookReturn = { ...hookReturn, patch: SELECTOR_PATCH };
    rerender(<AiFixOrchestrator activeTab={TAB} onPatchApplied={onPatchApplied} />);

    await waitFor(() =>
      expect(reportAppInteraction).toHaveBeenCalledWith(
        UserInteraction.AiFixFailed,
        expect.objectContaining({ reason: 'low-confidence: no live match' })
      )
    );
    expect(onPatchApplied).not.toHaveBeenCalled();
    expect(applyPatchToGuide).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'alert-warning' }));
  });

  it('surfaces a generation error as a warning toast', async () => {
    const { rerender } = render(<AiFixOrchestrator activeTab={TAB} onPatchApplied={jest.fn()} />);
    await dispatchRequest();

    hookReturn = { ...hookReturn, error: new Error('assistant exploded') };
    rerender(<AiFixOrchestrator activeTab={TAB} onPatchApplied={jest.fn()} />);

    await waitFor(() =>
      expect(reportAppInteraction).toHaveBeenCalledWith(
        UserInteraction.AiFixFailed,
        expect.objectContaining({ reason: 'assistant exploded' })
      )
    );
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'alert-warning' }));
  });

  it('applies the patch to the originating tab even after a tab switch', async () => {
    const onPatchApplied = jest.fn();
    const { rerender } = render(<AiFixOrchestrator activeTab={TAB} onPatchApplied={onPatchApplied} />);
    await dispatchRequest();

    // User switches to another tab while the assistant is still thinking.
    hookReturn = { ...hookReturn, patch: SELECTOR_PATCH };
    rerender(<AiFixOrchestrator activeTab={OTHER_TAB} onPatchApplied={onPatchApplied} />);

    await waitFor(() => expect(onPatchApplied).toHaveBeenCalledTimes(1));
    expect(onPatchApplied).toHaveBeenCalledWith('tab1', expect.any(String));
    expect(applyPatchToGuide).toHaveBeenCalledWith(TAB.content!.content, SELECTOR_PATCH);
  });

  it('self-heals the in-flight gate when generation never resolves', async () => {
    jest.useFakeTimers();
    try {
      render(<AiFixOrchestrator activeTab={TAB} onPatchApplied={jest.fn()} />);
      await dispatchRequest();
      expect(generate).toHaveBeenCalledTimes(1);

      // A second request is dropped while the first is still in flight.
      await dispatchRequest();
      expect(generate).toHaveBeenCalledTimes(1);

      act(() => {
        jest.runOnlyPendingTimers();
      });
      expect(reportAppInteraction).toHaveBeenCalledWith(
        UserInteraction.AiFixFailed,
        expect.objectContaining({ reason: 'timeout' })
      );

      // Gate is clear again — a fresh request goes through.
      await dispatchRequest();
      expect(generate).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});
