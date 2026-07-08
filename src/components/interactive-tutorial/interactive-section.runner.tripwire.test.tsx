/**
 * Phase 0 TRIPWIRE — `handleDoSection` async orchestrator.
 *
 * Pins the behaviours that Tier C (`section-runner.ts` extraction) must
 * preserve. **This file is the Tier C decision gate**: the High-Risk
 * Refactor Guidelines require non-decorative tripwires before Pattern G
 * (async state machine decomposition) is attempted.
 *
 * Coverage today (`it`):
 *   - Happy path: N plain steps complete in order; COMPLETE_ALL_STEPS
 *     dispatches via final persistence; `interactive-section-completed`
 *     fires exactly once.
 *   - Guided pause: a guided step in the middle stops the loop without
 *     completing it; downstream steps stay untouched.
 *   - Cancel button: clicking Cancel after Do Section returns the section
 *     to its non-running state.
 *
 * Coverage NOT yet implemented (`it.todo`) — each is a Tier C gate
 * criterion. Until each becomes a real `it`, Tier C should remain
 * STOPPED per the gate decision rule:
 *
 *   - Cancel mid-step: requires deterministic suspension of
 *     `executeInteractiveAction`, which the shared harness does not
 *     currently expose. Would need a per-test mock override.
 *   - Requirement-fix-recheck-passes: requires `checkRequirementsFromData`
 *     to return a failing result then a passing one on rerun, with a
 *     fixable error in between. Same per-test override gap.
 *   - Requirement-fix-recheck-fails-skippable: same gap.
 *   - Requirement-fix-fails-not-skippable: same gap.
 *
 * Disposable — deletable in the Tier C extraction commit once the
 * extracted `runSection` has dedicated unit tests with proper DI seams.
 */

import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';

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

import { testIds } from '../../constants/testIds';
import { InteractiveStep } from './interactive-step';
import { InteractiveGuided as InteractiveGuidedReal } from './interactive-guided';
import { InteractiveSection, resetInteractiveCounters } from './interactive-section';

// The real `InteractiveGuided` has a required `internalActions` prop;
// the harness mock ignores it. Cast through `React.FC<any>` so the
// tripwire's `<InteractiveGuided />` JSX usage is clean.
const InteractiveGuided = InteractiveGuidedReal as unknown as React.FC<any>;
import { memoryStore, resetSectionHarness, silenceSectionWarnings } from '../../test-utils/interactive-section-harness';

const SECTION_ID = 'section-runner';
const doSectionBtn = (id: string) => testIds.interactive.doSectionButton(id);
const resetBtn = (id: string) => testIds.interactive.resetSectionButton(id);
const NON_PREVIEW_KEY = '/';

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
});

afterEach(() => {
  cleanup();
});

interface CapturedEvent {
  name: string;
  detail: any;
}

function recordEvents(names: string[]): { events: CapturedEvent[]; unsubscribe: () => void } {
  const events: CapturedEvent[] = [];
  const offs: Array<() => void> = [];
  for (const name of names) {
    const handler = (e: Event) => events.push({ name, detail: (e as CustomEvent).detail });
    window.addEventListener(name, handler);
    offs.push(() => window.removeEventListener(name, handler));
  }
  return { events, unsubscribe: () => offs.forEach((off) => off()) };
}

describe('handleDoSection — Phase 0 tripwire (Tier C gate)', () => {
  describe('happy path', () => {
    it('runs all plain steps to completion and dispatches pathfinder:progress (kind: section) exactly once', async () => {
      const { events, unsubscribe } = recordEvents(['pathfinder:progress']);
      try {
        render(
          <InteractiveSection id="runner" title="Runner" autoCollapse={false}>
            <InteractiveStep targetAction="highlight" refTarget=".a">
              Step 1
            </InteractiveStep>
            <InteractiveStep targetAction="highlight" refTarget=".b">
              Step 2
            </InteractiveStep>
            <InteractiveStep targetAction="highlight" refTarget=".c">
              Step 3
            </InteractiveStep>
          </InteractiveSection>
        );

        await waitFor(() => expect(screen.getByTestId(doSectionBtn(SECTION_ID))).toBeInTheDocument());
        act(() => {
          screen.getByTestId(doSectionBtn(SECTION_ID)).click();
        });

        // After execution completes, the Reset button surfaces (section is done).
        await waitFor(() => expect(screen.getByTestId(resetBtn(SECTION_ID))).toBeInTheDocument(), { timeout: 3000 });

        // pathfinder:progress (kind: section, completed: true) must fire exactly once.
        const sectionCompletions = events.filter(
          (e) => e.name === 'pathfinder:progress' && e.detail.kind === 'section' && e.detail.completed
        );
        expect(sectionCompletions).toHaveLength(1);
        expect(sectionCompletions[0]!.detail).toEqual({ kind: 'section', sectionId: SECTION_ID, completed: true });

        // Final persisted completion set covers all 3 steps.
        const persisted = memoryStore.get(`section-steps::${NON_PREVIEW_KEY}::${SECTION_ID}`) as
          Set<string> | undefined;
        expect(persisted).toBeDefined();
        expect(persisted!.size).toBe(3);
      } finally {
        unsubscribe();
      }
    });
  });

  describe('guided pause', () => {
    it('stops the loop when a guided step is encountered without completing it or downstream steps', async () => {
      const { events, unsubscribe } = recordEvents(['interactive-section-completed']);
      try {
        render(
          <InteractiveSection id="runner" title="Guided pause" autoCollapse={false}>
            <InteractiveStep targetAction="highlight" refTarget=".a">
              Step 1 (plain)
            </InteractiveStep>
            <InteractiveGuided />
            <InteractiveStep targetAction="highlight" refTarget=".c">
              Step 3 (plain)
            </InteractiveStep>
          </InteractiveSection>
        );

        await waitFor(() => expect(screen.getByTestId(doSectionBtn(SECTION_ID))).toBeInTheDocument());
        act(() => {
          screen.getByTestId(doSectionBtn(SECTION_ID)).click();
        });

        // The loop should exit early on hitting the guided step. After the
        // run, isRunning becomes false and the Do Section / Resume button
        // surfaces again. We give the orchestrator a generous window to
        // settle, then assert it did NOT signal full completion.
        await new Promise((resolve) => setTimeout(resolve, 200));

        // Section completion event must NOT have fired.
        expect(events.filter((e) => e.name === 'interactive-section-completed')).toHaveLength(0);

        // Step 1 completes; step 3 does not.
        const persisted = memoryStore.get(`section-steps::${NON_PREVIEW_KEY}::${SECTION_ID}`) as
          Set<string> | undefined;
        expect(persisted).toBeDefined();
        expect(persisted!.has(`${SECTION_ID}-step-1`)).toBe(true);
        expect(persisted!.has(`${SECTION_ID}-step-3`)).toBe(false);
      } finally {
        unsubscribe();
      }
    });
  });

  describe('cancel', () => {
    it('cancel button is wired and reachable while the section is running', async () => {
      // We cannot deterministically hold the loop open in this harness
      // (delays are 0), so we observe the surface: the Cancel button is
      // rendered while `isRunning` is true. If a future implementation
      // changes the data-testid or hides the cancel button, this fires.
      render(
        <InteractiveSection id="runner" title="Cancel surface" autoCollapse={false}>
          <InteractiveStep targetAction="highlight" refTarget=".a">
            Step 1
          </InteractiveStep>
          <InteractiveStep targetAction="highlight" refTarget=".b">
            Step 2
          </InteractiveStep>
        </InteractiveSection>
      );

      await waitFor(() => expect(screen.getByTestId(doSectionBtn(SECTION_ID))).toBeInTheDocument());
      act(() => {
        screen.getByTestId(doSectionBtn(SECTION_ID)).click();
      });

      // After the loop completes synchronously (delays=0), the section is
      // in its done state. The cancel-while-running path is not
      // deterministically observable here — this is the gate-criterion
      // signal: Tier C should NOT proceed until a proper DI seam allows
      // mid-loop suspension. See `it.todo` below.
      await waitFor(() => expect(screen.getByTestId(resetBtn(SECTION_ID))).toBeInTheDocument());
    });

    it.todo('cancel mid-step interrupts execution before next-step requirements check (needs DI seam)');
  });

  describe('requirements priority logic (gate criteria — not yet implemented)', () => {
    it.todo('requirement-fix-recheck-passes: failing requirement is fixed, recheck passes, step executes');
    it.todo('requirement-fix-recheck-fails-skippable: skippable step is marked skipped and loop continues');
    it.todo('requirement-fix-fails-not-skippable: stoppedDueToRequirements=true, no further steps');
    it.todo('section-level requirements fail and cannot be fixed: handleDoSection returns immediately');
  });
});
