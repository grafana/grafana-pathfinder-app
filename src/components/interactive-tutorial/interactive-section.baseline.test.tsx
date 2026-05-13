/**
 * DISPOSABLE — baseline characterization for the #842 acknowledgement-gate
 * refactor.
 *
 * Captures the externally observable state-machine behaviour of
 * `InteractiveSection` BEFORE the gate is introduced and before the reducer
 * is collapsed into a discriminated union. Refactor phases 1–4 must keep
 * every assertion here green; phase 5 (gate enable) replaces the cases that
 * become semantically different, while non-gated transitions stay covered by
 * the permanent `interactive-section.state-machine.test.tsx`.
 *
 * Remove this file in phase 7 once `interactive-section.state-machine.test.tsx`
 * subsumes every transition asserted below.
 */

import React from 'react';
import { render, screen, act, waitFor, cleanup } from '@testing-library/react';

import { testIds } from '../../constants/testIds';

// ─── Mocks ──────────────────────────────────────────────────────────────────

jest.mock('@grafana/ui', () => ({
  Button: ({ children, onClick, disabled, ...rest }: any) =>
    React.createElement('button', { onClick, disabled, ...rest }, children),
}));

jest.mock('@grafana/data', () => ({
  usePluginContext: () => ({ meta: { jsonData: {} } }),
}));

jest.mock('../../lib/analytics', () => {
  return require('../../test-utils/interactive-section-harness').createAnalyticsMock();
});

jest.mock('../../constants', () => {
  return require('../../test-utils/interactive-section-harness').createConstantsMock();
});

jest.mock('../../constants/interactive-config', () => {
  return require('../../test-utils/interactive-section-harness').createInteractiveConfigMock();
});

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

// Real getContentKey is fine — jsdom defaults to window.location.pathname,
// which yields `/` (a non-preview key). Override at runtime when a test
// needs preview-mode semantics.

// ─── Imports after mocks ────────────────────────────────────────────────────

import { InteractiveStep } from './interactive-step';
import { InteractiveSection, resetInteractiveCounters } from './interactive-section';
import { resetSectionHarness, silenceSectionWarnings, memoryStore } from '../../test-utils/interactive-section-harness';

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
  // Reset window globals that getContentKey reads.
  (window as any).__DocsPluginActiveTabUrl = undefined;
  (window as any).__DocsPluginContentKey = undefined;
});

afterEach(() => {
  cleanup();
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function renderSingleStepSection() {
  return render(
    <InteractiveSection id="basic" title="Basic section">
      <InteractiveStep targetAction="highlight" refTarget=".whatever">
        The only step
      </InteractiveStep>
    </InteractiveSection>
  );
}

function renderTwoStepSection() {
  return render(
    <InteractiveSection id="two" title="Two-step section">
      <InteractiveStep targetAction="highlight" refTarget=".first">
        Step one
      </InteractiveStep>
      <InteractiveStep targetAction="highlight" refTarget=".second">
        Step two
      </InteractiveStep>
    </InteractiveSection>
  );
}

const SECTION_BASIC = 'section-basic';
const STEP_BASIC = `${SECTION_BASIC}-step-1`;
const SECTION_TWO = 'section-two';

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('InteractiveSection — baseline state machine (pre-#842 gate)', () => {
  describe('INIT', () => {
    it('renders the "Do Section" button and no reset button on first mount', async () => {
      renderSingleStepSection();

      await waitFor(() => {
        expect(screen.getByTestId(testIds.interactive.doSectionButton(SECTION_BASIC))).toBeInTheDocument();
      });
      expect(screen.queryByTestId(testIds.interactive.resetSectionButton(SECTION_BASIC))).not.toBeInTheDocument();
    });

    it('renders the harness step stub for the only step', async () => {
      renderSingleStepSection();

      await waitFor(() => {
        expect(screen.getByTestId(`step-stub-${STEP_BASIC}`)).toBeInTheDocument();
      });
    });
  });

  describe('INIT → step complete → DONE (single-step, no trailing passive)', () => {
    it('flips to the Reset button after the only step completes', async () => {
      renderSingleStepSection();

      await waitFor(() => {
        expect(screen.getByTestId(`harness-complete-${STEP_BASIC}`)).toBeInTheDocument();
      });

      act(() => {
        screen.getByTestId(`harness-complete-${STEP_BASIC}`).click();
      });

      await waitFor(() => {
        expect(screen.getByTestId(testIds.interactive.resetSectionButton(SECTION_BASIC))).toBeInTheDocument();
      });
      expect(screen.queryByTestId(testIds.interactive.doSectionButton(SECTION_BASIC))).not.toBeInTheDocument();
    });

    it('persists the completed step id under the section storage key', async () => {
      renderSingleStepSection();

      await waitFor(() => expect(screen.getByTestId(`harness-complete-${STEP_BASIC}`)).toBeInTheDocument());

      act(() => {
        screen.getByTestId(`harness-complete-${STEP_BASIC}`).click();
      });

      await waitFor(() => {
        const stored = memoryStore.get(`section-steps::/::${SECTION_BASIC}`) as Set<string> | undefined;
        expect(stored).toBeDefined();
        expect(stored!.has(STEP_BASIC)).toBe(true);
      });
    });
  });

  describe('multi-step: INIT → step 1 → step 2 → DONE', () => {
    it('keeps the Do Section button visible until every non-noop step has completed', async () => {
      renderTwoStepSection();

      await waitFor(() => expect(screen.getByTestId(`step-stub-${SECTION_TWO}-step-1`)).toBeInTheDocument());

      // After step 1 completes there is still step 2 outstanding → Do Section
      // remains visible.
      act(() => {
        screen.getByTestId(`harness-complete-${SECTION_TWO}-step-1`).click();
      });

      await waitFor(() => {
        expect(screen.getByTestId(testIds.interactive.doSectionButton(SECTION_TWO))).toBeInTheDocument();
      });
      expect(screen.queryByTestId(testIds.interactive.resetSectionButton(SECTION_TWO))).not.toBeInTheDocument();

      // Completing step 2 flips us to the Reset button.
      act(() => {
        screen.getByTestId(`harness-complete-${SECTION_TWO}-step-2`).click();
      });

      await waitFor(() => {
        expect(screen.getByTestId(testIds.interactive.resetSectionButton(SECTION_TWO))).toBeInTheDocument();
      });
    });
  });

  describe('DONE → step Redo → PARTIAL', () => {
    it('removes the redone step from completedSteps and reveals "Do Section" again', async () => {
      // Use autoCollapse=false so the step stub stays in the DOM after DONE
      // — without that, the section auto-collapses and the harness redo
      // button is unmounted.
      render(
        <InteractiveSection id="basic" title="Basic section" autoCollapse={false}>
          <InteractiveStep targetAction="highlight" refTarget=".whatever">
            The only step
          </InteractiveStep>
        </InteractiveSection>
      );

      await waitFor(() => expect(screen.getByTestId(`harness-complete-${STEP_BASIC}`)).toBeInTheDocument());

      // Reach DONE.
      act(() => {
        screen.getByTestId(`harness-complete-${STEP_BASIC}`).click();
      });
      await waitFor(() =>
        expect(screen.getByTestId(testIds.interactive.resetSectionButton(SECTION_BASIC))).toBeInTheDocument()
      );

      // Redo via the step's onStepReset (still reachable since autoCollapse=false).
      act(() => {
        screen.getByTestId(`harness-redo-${STEP_BASIC}`).click();
      });

      await waitFor(() => {
        expect(screen.getByTestId(testIds.interactive.doSectionButton(SECTION_BASIC))).toBeInTheDocument();
      });
      expect(screen.queryByTestId(testIds.interactive.resetSectionButton(SECTION_BASIC))).not.toBeInTheDocument();
    });
  });

  describe('DONE → Reset section → INIT', () => {
    it('clears completedSteps and returns to "Do Section"', async () => {
      renderSingleStepSection();

      await waitFor(() => expect(screen.getByTestId(`harness-complete-${STEP_BASIC}`)).toBeInTheDocument());

      act(() => {
        screen.getByTestId(`harness-complete-${STEP_BASIC}`).click();
      });
      await waitFor(() =>
        expect(screen.getByTestId(testIds.interactive.resetSectionButton(SECTION_BASIC))).toBeInTheDocument()
      );

      act(() => {
        screen.getByTestId(testIds.interactive.resetSectionButton(SECTION_BASIC)).click();
      });

      await waitFor(() => {
        expect(screen.getByTestId(testIds.interactive.doSectionButton(SECTION_BASIC))).toBeInTheDocument();
      });
    });
  });

  describe('mount-restore', () => {
    it('restores a section to DONE when storage contains every step id', async () => {
      // Seed storage BEFORE the section renders. The mount-restore effect
      // should pick it up and immediately surface the Reset state.
      memoryStore.set(`section-steps::/::${SECTION_BASIC}`, new Set([STEP_BASIC]));

      renderSingleStepSection();

      await waitFor(() => {
        expect(screen.getByTestId(testIds.interactive.resetSectionButton(SECTION_BASIC))).toBeInTheDocument();
      });
      expect(screen.queryByTestId(testIds.interactive.doSectionButton(SECTION_BASIC))).not.toBeInTheDocument();
    });
  });
});

// ─── Producer-contract characterization (event surface — bug-2 baseline) ────

describe('InteractiveSection — event-dispatch baseline (Bug 2 tripwire)', () => {
  it('dispatches "interactive-progress-saved" when ids.size > 0', async () => {
    const events: CustomEvent[] = [];
    const handler = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener('interactive-progress-saved', handler);

    try {
      renderSingleStepSection();
      await waitFor(() => expect(screen.getByTestId(`harness-complete-${STEP_BASIC}`)).toBeInTheDocument());

      act(() => {
        screen.getByTestId(`harness-complete-${STEP_BASIC}`).click();
      });

      await waitFor(() => {
        expect(events.some((e) => e.detail?.hasProgress === true)).toBe(true);
      });
    } finally {
      window.removeEventListener('interactive-progress-saved', handler);
    }
  });

  it('dispatches "interactive-progress-cleared" from handleResetSection (bug-2 fix, phase 3)', async () => {
    const events: CustomEvent[] = [];
    const handler = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener('interactive-progress-cleared', handler);

    try {
      renderSingleStepSection();
      await waitFor(() => expect(screen.getByTestId(`harness-complete-${STEP_BASIC}`)).toBeInTheDocument());

      act(() => {
        screen.getByTestId(`harness-complete-${STEP_BASIC}`).click();
      });
      await waitFor(() =>
        expect(screen.getByTestId(testIds.interactive.resetSectionButton(SECTION_BASIC))).toBeInTheDocument()
      );

      act(() => {
        screen.getByTestId(testIds.interactive.resetSectionButton(SECTION_BASIC)).click();
      });

      await waitFor(() => {
        expect(events.length).toBeGreaterThanOrEqual(1);
      });
      expect(events[0]!.detail?.contentKey).toBe('/');
    } finally {
      window.removeEventListener('interactive-progress-cleared', handler);
    }
  });
});

// ─── Preview-mode storage-sandbox baseline (Bug 3 tripwire) ─────────────────

describe('InteractiveSection — preview-mode storage sandbox (Bug 3 tripwire)', () => {
  beforeEach(() => {
    // Force isPreviewMode to true.
    (window as any).__DocsPluginActiveTabUrl = 'block-editor://preview/test-guide';
  });

  it('does NOT persist completedSteps to storage in preview mode (bug-3 fix, phase 3)', async () => {
    renderSingleStepSection();
    await waitFor(() => expect(screen.getByTestId(`harness-complete-${STEP_BASIC}`)).toBeInTheDocument());

    act(() => {
      screen.getByTestId(`harness-complete-${STEP_BASIC}`).click();
    });

    // The section still reaches DONE in-memory, but localStorage stays clean.
    await waitFor(() =>
      expect(screen.getByTestId(testIds.interactive.resetSectionButton(SECTION_BASIC))).toBeInTheDocument()
    );

    const stored = memoryStore.get(`section-steps::block-editor://preview/test-guide::${SECTION_BASIC}`);
    expect(stored).toBeUndefined();
  });

  it('does NOT restore completed steps from storage on mount in preview mode (bug-3 fix, phase 3)', async () => {
    // Seed storage as if a previous buggy version had persisted progress
    // under the preview content key. The new mount-restore guard must
    // ignore it — the section comes back to INIT.
    memoryStore.set(`section-steps::block-editor://preview/test-guide::${SECTION_BASIC}`, new Set([STEP_BASIC]));

    renderSingleStepSection();

    await waitFor(() =>
      expect(screen.getByTestId(testIds.interactive.doSectionButton(SECTION_BASIC))).toBeInTheDocument()
    );
    expect(screen.queryByTestId(testIds.interactive.resetSectionButton(SECTION_BASIC))).not.toBeInTheDocument();
  });
});
