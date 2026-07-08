/**
 * PERMANENT — state-machine integration test for issue #842.
 *
 * Walks the canonical transitions of `InteractiveSection` end-to-end
 * (real reducer + real `analyzeAcknowledgement` + real `deriveSectionState`
 * + real DOM), against the discriminated-union state machine introduced
 * in phase 4 and the acknowledgement gate enabled in phase 5.
 *
 * The pure reducer is exhaustively tested at the unit level in
 * `section-state.test.ts`. This file's job is to verify the wiring:
 *   - The right button surfaces at the right `kind`.
 *   - Storage IO happens (or doesn't) as the gate requires.
 *   - The Bug 1 regression scenario stays dead.
 *
 * The mock harness comes from `src/test-utils/interactive-section-harness`
 * so this file shares its plumbing with the disposable baseline suite.
 */

import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';

import { testIds } from '../../constants/testIds';

// ─── Mocks ──────────────────────────────────────────────────────────────────

jest.mock('@grafana/ui', () => {
  return require('../../test-utils/interactive-section-harness').createGrafanaUiMock();
});

jest.mock('@grafana/data', () => {
  return require('../../test-utils/interactive-section-harness').createGrafanaDataMock();
});

jest.mock('../../lib/analytics', () => {
  return require('../../test-utils/interactive-section-harness').createAnalyticsMock();
});

jest.mock('../../constants', () => {
  return require('../../test-utils/interactive-section-harness').createConstantsMock();
});

jest.mock('../../constants/interactive-config', () => {
  return require('../../test-utils/interactive-section-harness').createInteractiveConfigMock();
});

jest.mock('../../lib/logging', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), exception: jest.fn() },
}));

jest.mock('../../lib/user-storage', () => {
  return require('../../test-utils/interactive-section-harness').createUserStorageMock();
});

jest.mock('../../global-state/alignment-pending-context', () => {
  return require('../../test-utils/interactive-section-harness').createAlignmentContextMock();
});

jest.mock('../../interactive-engine', () => {
  return require('../../test-utils/interactive-section-harness').createInteractiveEngineMock();
});

jest.mock('../../requirements-manager', () => {
  return require('../../test-utils/interactive-section-harness').createRequirementsManagerMock();
});

jest.mock('../../docs-retrieval', () => {
  return require('../../test-utils/interactive-section-harness').createDocsRetrievalMock();
});

jest.mock('./interactive-step', () => {
  return require('../../test-utils/interactive-section-harness').createInteractiveStepMock();
});

jest.mock('./interactive-multi-step', () => {
  return require('../../test-utils/interactive-section-harness').createInteractiveMultiStepMock();
});

jest.mock('./interactive-guided', () => {
  return require('../../test-utils/interactive-section-harness').createInteractiveGuidedMock();
});

jest.mock('./interactive-quiz', () => {
  return require('../../test-utils/interactive-section-harness').createInteractiveQuizMock();
});

jest.mock('./terminal-step', () => {
  return require('../../test-utils/interactive-section-harness').createTerminalStepMock();
});

jest.mock('./terminal-connect-step', () => {
  return require('../../test-utils/interactive-section-harness').createTerminalConnectStepMock();
});

jest.mock('./code-block-step', () => {
  return require('../../test-utils/interactive-section-harness').createCodeBlockStepMock();
});

jest.mock('./interactive-conditional', () => {
  return require('../../test-utils/interactive-section-harness').createInteractiveConditionalMock();
});

// ─── Imports after mocks ────────────────────────────────────────────────────

import { InteractiveStep } from './interactive-step';
import { InteractiveSection, resetInteractiveCounters } from './interactive-section';
import {
  memoryStore,
  resetSectionHarness,
  silenceSectionWarnings,
  setCheckRequirementsResult,
} from '../../test-utils/interactive-section-harness';

// ─── Setup ──────────────────────────────────────────────────────────────────

let warnSpy: jest.SpyInstance;
beforeAll(() => {
  warnSpy = silenceSectionWarnings();
});
afterAll(() => {
  warnSpy.mockRestore();
});

beforeEach(() => {
  resetSectionHarness();
  resetInteractiveCounters();
  (window as any).__DocsPluginActiveTabUrl = undefined;
  (window as any).__DocsPluginContentKey = undefined;
});

afterEach(() => {
  cleanup();
});

const NON_PREVIEW_KEY = '/';
const PREVIEW_KEY_OVERRIDE = 'block-editor://preview/test-guide';

// ─── Fixtures ───────────────────────────────────────────────────────────────

function renderNoGateSection() {
  return render(
    <InteractiveSection id="nogate" title="No-gate section" autoCollapse={false}>
      <InteractiveStep targetAction="highlight" refTarget=".a">
        Step
      </InteractiveStep>
    </InteractiveSection>
  );
}

function renderTrailingGateSection() {
  return render(
    <InteractiveSection id="gated" title="Trailing-gate section" autoCollapse={false}>
      <InteractiveStep targetAction="highlight" refTarget=".a">
        The interactive bit
      </InteractiveStep>
      <p>Trailing passive markdown — read me before continuing.</p>
    </InteractiveSection>
  );
}

function renderAllPassiveSection() {
  return render(
    <InteractiveSection id="passive" title="All-passive section" autoCollapse={false}>
      <p>First paragraph.</p>
      <p>Second paragraph.</p>
    </InteractiveSection>
  );
}

const SECTION_NOGATE = 'section-nogate';
const STEP_NOGATE = `${SECTION_NOGATE}-step-1`;
const SECTION_GATED = 'section-gated';
const STEP_GATED = `${SECTION_GATED}-step-1`;
const SECTION_PASSIVE = 'section-passive';

const doButton = (id: string) => testIds.interactive.doSectionButton(id);
const resetButton = (id: string) => testIds.interactive.resetSectionButton(id);
const markButton = (id: string) => testIds.interactive.markSectionCompleteButton(id);
const complete = (stepId: string) => `harness-complete-${stepId}`;
const redo = (stepId: string) => `harness-redo-${stepId}`;

async function click(testId: string) {
  await waitFor(() => expect(screen.getByTestId(testId)).toBeInTheDocument());
  act(() => {
    screen.getByTestId(testId).click();
  });
}

// ─── Scenarios ──────────────────────────────────────────────────────────────

describe('InteractiveSection state machine — #842 acknowledgement gate', () => {
  describe('no-gate sections (no trailing passive)', () => {
    it('1. init → step complete → done(no-gate-needed) — Mark button never appears', async () => {
      renderNoGateSection();

      await waitFor(() => expect(screen.getByTestId(doButton(SECTION_NOGATE))).toBeInTheDocument());
      expect(screen.queryByTestId(markButton(SECTION_NOGATE))).not.toBeInTheDocument();

      await click(complete(STEP_NOGATE));

      await waitFor(() => expect(screen.getByTestId(resetButton(SECTION_NOGATE))).toBeInTheDocument());
      expect(screen.queryByTestId(markButton(SECTION_NOGATE))).not.toBeInTheDocument();
    });
  });

  describe('trailing-passive gate sections', () => {
    it('2. init → step complete → awaiting-ack → Mark → done(ack)', async () => {
      renderTrailingGateSection();

      await waitFor(() => expect(screen.getByTestId(doButton(SECTION_GATED))).toBeInTheDocument());

      await click(complete(STEP_GATED));

      // After completing the only interactive step, the gate fires:
      // Mark button visible; Reset NOT yet visible (we aren't done yet).
      await waitFor(() => expect(screen.getByTestId(markButton(SECTION_GATED))).toBeInTheDocument());
      expect(screen.queryByTestId(resetButton(SECTION_GATED))).not.toBeInTheDocument();
      expect(screen.queryByTestId(doButton(SECTION_GATED))).not.toBeInTheDocument();

      await click(markButton(SECTION_GATED));

      // Mark click promotes the section to done(ack): Reset button replaces Mark.
      await waitFor(() => expect(screen.getByTestId(resetButton(SECTION_GATED))).toBeInTheDocument());
      expect(screen.queryByTestId(markButton(SECTION_GATED))).not.toBeInTheDocument();
    });

    it('persists ack=true to storage on Mark click (non-preview)', async () => {
      renderTrailingGateSection();
      await click(complete(STEP_GATED));
      await click(markButton(SECTION_GATED));

      await waitFor(() => {
        expect(memoryStore.get(`section-ack::${NON_PREVIEW_KEY}::${SECTION_GATED}`)).toBe(true);
      });
    });
  });

  describe('all-passive sections', () => {
    it('3. init (no interactive children) shows only the Mark button; Mark → done(ack)', async () => {
      renderAllPassiveSection();

      await waitFor(() => expect(screen.getByTestId(markButton(SECTION_PASSIVE))).toBeInTheDocument());
      // Do Section is suppressed entirely — the user has no interactive
      // work to do, only acknowledgement.
      expect(screen.queryByTestId(doButton(SECTION_PASSIVE))).not.toBeInTheDocument();
      expect(screen.queryByTestId(resetButton(SECTION_PASSIVE))).not.toBeInTheDocument();

      await click(markButton(SECTION_PASSIVE));

      await waitFor(() => expect(screen.getByTestId(resetButton(SECTION_PASSIVE))).toBeInTheDocument());
      expect(screen.queryByTestId(markButton(SECTION_PASSIVE))).not.toBeInTheDocument();
    });

    it('3b. Reset Section is ENABLED after Mark on an all-passive section, and clicking it returns to awaiting-ack', async () => {
      // Regression for the "all-passive Reset stays permanently
      // disabled" bug. The catch-all button's empty-section disable
      // clause is now scoped to the Do-Section path only.
      renderAllPassiveSection();

      await click(markButton(SECTION_PASSIVE));
      await waitFor(() => expect(screen.getByTestId(resetButton(SECTION_PASSIVE))).toBeInTheDocument());

      // The button must not be disabled.
      const reset = screen.getByTestId(resetButton(SECTION_PASSIVE));
      expect(reset).not.toBeDisabled();

      // Clicking it clears completion + ack → the section returns to
      // awaiting-ack (its only available init state for all-passive).
      act(() => {
        reset.click();
      });

      await waitFor(() => expect(screen.getByTestId(markButton(SECTION_PASSIVE))).toBeInTheDocument());
      expect(screen.queryByTestId(resetButton(SECTION_PASSIVE))).not.toBeInTheDocument();
      // Ack storage should also be cleared.
      expect(memoryStore.get(`section-ack::${NON_PREVIEW_KEY}::${SECTION_PASSIVE}`)).toBeUndefined();
    });
  });

  describe('Bug 1 regression — Redo must re-arm the gate', () => {
    it('4. done(ack) → step Redo → partial → re-complete → awaiting-ack (NOT a silent jump to done)', async () => {
      renderTrailingGateSection();

      // Walk to done(ack).
      await click(complete(STEP_GATED));
      await click(markButton(SECTION_GATED));
      await waitFor(() => expect(screen.getByTestId(resetButton(SECTION_GATED))).toBeInTheDocument());

      // Click Redo on the only step. The reducer's RESET_STEP transition
      // clears ack alongside completion.
      await click(redo(STEP_GATED));

      // Back to init: Do Section visible, Mark and Reset gone.
      await waitFor(() => expect(screen.getByTestId(doButton(SECTION_GATED))).toBeInTheDocument());
      expect(screen.queryByTestId(markButton(SECTION_GATED))).not.toBeInTheDocument();
      expect(screen.queryByTestId(resetButton(SECTION_GATED))).not.toBeInTheDocument();

      // Re-complete the step. The gate MUST re-fire — Mark, not Reset.
      // This is the Bug 1 regression assertion: a silent transition back
      // to done would mean ack leaked across the Redo.
      await click(complete(STEP_GATED));

      await waitFor(() => expect(screen.getByTestId(markButton(SECTION_GATED))).toBeInTheDocument());
      expect(screen.queryByTestId(resetButton(SECTION_GATED))).not.toBeInTheDocument();
    });
  });

  describe('Redo from awaiting-ack', () => {
    it('5. awaiting-ack → step Redo → partial (ack stays cleared)', async () => {
      renderTrailingGateSection();
      await click(complete(STEP_GATED));
      await waitFor(() => expect(screen.getByTestId(markButton(SECTION_GATED))).toBeInTheDocument());

      // Redo without clicking Mark first.
      await click(redo(STEP_GATED));

      await waitFor(() => expect(screen.getByTestId(doButton(SECTION_GATED))).toBeInTheDocument());
      expect(screen.queryByTestId(markButton(SECTION_GATED))).not.toBeInTheDocument();
      expect(memoryStore.get(`section-ack::${NON_PREVIEW_KEY}::${SECTION_GATED}`)).toBeUndefined();
    });
  });

  describe('Reset section clears completion + ack + event', () => {
    it('6. done(ack) → Reset section → init (both storage keys cleared, cleared event dispatched)', async () => {
      // Pre-seed an ack entry so we can observe its clearance.
      memoryStore.set(`section-ack::${NON_PREVIEW_KEY}::${SECTION_GATED}`, true);
      memoryStore.set(`section-steps::${NON_PREVIEW_KEY}::${SECTION_GATED}`, new Set([STEP_GATED]));

      renderTrailingGateSection();

      const clearedEvents: CustomEvent[] = [];
      const handler = (e: Event) => clearedEvents.push(e as CustomEvent);
      window.addEventListener('interactive-progress-cleared', handler);

      try {
        // Mount-restore + migration: completed contains the step, ack
        // is true → derived state is done(ack), Reset button visible.
        await waitFor(() => expect(screen.getByTestId(resetButton(SECTION_GATED))).toBeInTheDocument());

        await click(resetButton(SECTION_GATED));

        // Section returns to init: Do Section visible, both storage
        // keys cleared, cleared event dispatched (Bug 2 fix).
        await waitFor(() => expect(screen.getByTestId(doButton(SECTION_GATED))).toBeInTheDocument());
        expect(memoryStore.get(`section-steps::${NON_PREVIEW_KEY}::${SECTION_GATED}`)).toBeUndefined();
        expect(memoryStore.get(`section-ack::${NON_PREVIEW_KEY}::${SECTION_GATED}`)).toBeUndefined();
        expect(clearedEvents.length).toBeGreaterThanOrEqual(1);
      } finally {
        window.removeEventListener('interactive-progress-cleared', handler);
      }
    });
  });

  describe('preview-mode sandbox', () => {
    beforeEach(() => {
      (window as any).__DocsPluginActiveTabUrl = PREVIEW_KEY_OVERRIDE;
    });

    it('7. complete + Mark in preview writes nothing to storage; remount returns to init', async () => {
      const { unmount } = renderTrailingGateSection();
      await click(complete(STEP_GATED));
      await click(markButton(SECTION_GATED));
      await waitFor(() => expect(screen.getByTestId(resetButton(SECTION_GATED))).toBeInTheDocument());

      // Nothing should have landed in storage under the preview key.
      expect(memoryStore.get(`section-steps::${PREVIEW_KEY_OVERRIDE}::${SECTION_GATED}`)).toBeUndefined();
      expect(memoryStore.get(`section-ack::${PREVIEW_KEY_OVERRIDE}::${SECTION_GATED}`)).toBeUndefined();

      unmount();
      // Seed a stale entry to prove mount-restore ignores it in preview.
      memoryStore.set(`section-steps::${PREVIEW_KEY_OVERRIDE}::${SECTION_GATED}`, new Set([STEP_GATED]));
      memoryStore.set(`section-ack::${PREVIEW_KEY_OVERRIDE}::${SECTION_GATED}`, true);

      renderTrailingGateSection();
      await waitFor(() => expect(screen.getByTestId(doButton(SECTION_GATED))).toBeInTheDocument());
      expect(screen.queryByTestId(resetButton(SECTION_GATED))).not.toBeInTheDocument();
    });
  });

  describe('mount-restore migration', () => {
    it('10. ack=null + completed=all + needsAck → auto-acknowledges on mount, sits at done(ack)', async () => {
      memoryStore.set(`section-steps::${NON_PREVIEW_KEY}::${SECTION_GATED}`, new Set([STEP_GATED]));
      // Note: ack key intentionally absent (null).

      renderTrailingGateSection();

      // Migration auto-acks: the user does NOT see the gate; Reset is
      // surfaced directly. Pre-#842 finished work stays finished.
      await waitFor(() => expect(screen.getByTestId(resetButton(SECTION_GATED))).toBeInTheDocument());
      expect(screen.queryByTestId(markButton(SECTION_GATED))).not.toBeInTheDocument();

      // The migration also writes ack=true back to storage so the next
      // mount doesn't re-evaluate the same migration.
      await waitFor(() => {
        expect(memoryStore.get(`section-ack::${NON_PREVIEW_KEY}::${SECTION_GATED}`)).toBe(true);
      });
    });

    it('mount-only restore — does not re-fire when children re-render', async () => {
      // Render once, then dispatch enough churn to force a re-render
      // without a remount. The didRestoreRef guard means the restore
      // effect runs exactly once.
      memoryStore.set(`section-steps::${NON_PREVIEW_KEY}::${SECTION_GATED}`, new Set([STEP_GATED]));

      const { rerender } = renderTrailingGateSection();
      await waitFor(() => expect(screen.getByTestId(resetButton(SECTION_GATED))).toBeInTheDocument());

      // Mutate storage out from under the section, then trigger a
      // re-render. If mount-restore re-fired the section would pick
      // up the cleared storage and revert to Do Section. It must not.
      memoryStore.delete(`section-steps::${NON_PREVIEW_KEY}::${SECTION_GATED}`);
      rerender(
        <InteractiveSection id="gated" title="Trailing-gate section (re-render)" autoCollapse={false}>
          <InteractiveStep targetAction="highlight" refTarget=".a">
            The interactive bit
          </InteractiveStep>
          <p>Trailing passive markdown — read me before continuing.</p>
        </InteractiveSection>
      );

      // Still done — restore did not re-fire.
      expect(screen.getByTestId(resetButton(SECTION_GATED))).toBeInTheDocument();
    });
  });
});

// ─── Section requirements fix button — issue #476 ───────────────────────────

describe('InteractiveSection — section requirements fix button (#476)', () => {
  beforeEach(() => {
    const { NavigationManager } = jest.requireMock('../../interactive-engine');
    NavigationManager.mockClear();
  });

  function renderSectionWithRequirements(requirements: string) {
    return render(
      <InteractiveSection
        id="req-section"
        title="Requirements section"
        requirements={requirements}
        autoCollapse={false}
      >
        <InteractiveStep targetAction="highlight" refTarget=".a">
          Step
        </InteractiveStep>
      </InteractiveSection>
    );
  }

  it('shows "Fix this" button when section requirement is fixable', async () => {
    setCheckRequirementsResult({
      pass: false,
      error: [
        {
          requirement: 'on-page:/explore',
          error: 'Not on the correct page',
          canFix: true,
          fixType: 'location',
          targetHref: '/explore',
        },
      ],
    });

    renderSectionWithRequirements('on-page:/explore');

    await waitFor(() => expect(screen.getByText('Fix this')).toBeInTheDocument());
  });

  it('does not show "Fix this" button when requirement is not fixable', async () => {
    setCheckRequirementsResult({
      pass: false,
      error: [
        {
          requirement: 'has-datasource:loki',
          error: 'The Loki data source needs to be configured first.',
          canFix: false,
        },
      ],
    });

    renderSectionWithRequirements('has-datasource:loki');

    // Wait for requirements check to complete: banner shows explanation, no Fix button
    await waitFor(() => expect(screen.getByText('Requirements not yet met.')).toBeInTheDocument());
    expect(screen.queryByText('Fix this')).not.toBeInTheDocument();
  });

  it('shows user-friendly explanation text instead of generic "Requirements not yet met"', async () => {
    setCheckRequirementsResult({
      pass: false,
      error: [
        {
          requirement: 'on-page:/explore',
          error: 'Not on the correct page',
          canFix: true,
          fixType: 'location',
          targetHref: '/explore',
        },
      ],
    });

    renderSectionWithRequirements('on-page:/explore');

    await waitFor(() => expect(screen.getByText('Navigate to the correct page first.')).toBeInTheDocument());
  });

  it('clicking "Fix this" invokes NavigationManager.fixLocationRequirement for location fixType', async () => {
    setCheckRequirementsResult({
      pass: false,
      error: [
        {
          requirement: 'on-page:/explore',
          error: 'Not on the correct page',
          canFix: true,
          fixType: 'location',
          targetHref: '/explore',
        },
      ],
    });

    renderSectionWithRequirements('on-page:/explore');

    await waitFor(() => expect(screen.getByText('Fix this')).toBeInTheDocument());

    // After click, fix should resolve and requirements recheck → pass
    setCheckRequirementsResult({ pass: true, error: [] });

    act(() => {
      screen.getByText('Fix this').click();
    });

    // mock.results tracks the return value of each new NavigationManager() call
    // (mock.instances tracks `this`, which is the empty prototype object when
    // mockImplementation returns a plain object — not what we want here)
    await waitFor(() => {
      const { NavigationManager } = jest.requireMock('../../interactive-engine');
      const results = NavigationManager.mock.results;
      expect(results.length).toBeGreaterThan(0);
      const instance = results[results.length - 1].value;
      expect(instance.fixLocationRequirement).toHaveBeenCalledWith('/explore');
    });
  });
});
