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
jest.mock('../../lib/faro', () => ({
  withFaroUserAction: jest.fn((_name: string, _attributes: unknown, work: () => unknown) => work()),
  setFaroUserActionAttributes: jest.fn(),
  USER_ACTION_TIMEOUT_LONG_MS: 600000,
}));
jest.mock('../../lib/user-storage', () => {
  return require('../../test-utils/interactive-section-harness').createUserStorageMock();
});
jest.mock('../../global-state/alignment-pending-context', () => {
  return require('../../test-utils/interactive-section-harness').createAlignmentContextMock();
});
jest.mock('../../interactive-engine', () => {
  const engine = require('../../test-utils/interactive-section-harness').createInteractiveEngineMock();
  const actionMonitor = engine.ActionMonitor.getInstance();
  const startSectionBlocking = jest.fn();
  const stopSectionBlocking = jest.fn();
  return {
    ...engine,
    useInteractiveElements: jest.fn(() => ({
      ...engine.useInteractiveElements(),
      startSectionBlocking,
      stopSectionBlocking,
    })),
    ActionMonitor: { getInstance: () => actionMonitor },
  };
});
jest.mock('./hooks/use-section-scroll', () => {
  const scroll = {
    scrollToStep: jest.fn(),
    beginProgrammaticScroll: jest.fn(),
    endProgrammaticScroll: jest.fn(),
  };
  return { useSectionScroll: jest.fn(() => scroll) };
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
jest.mock('./datasource-check-step', () => {
  return require('../../test-utils/interactive-section-harness').createDatasourceCheckStepMock();
});
jest.mock('./interactive-conditional', () => {
  return require('../../test-utils/interactive-section-harness').createInteractiveConditionalMock();
});

import { testIds } from '../../constants/testIds';
import { ActionMonitor, NavigationManager, useInteractiveElements } from '../../interactive-engine';
import { dispatchInteractiveProgressCleared, type InteractiveProgressClearedDetail } from '../../lib/event-names';
import { withFaroUserAction } from '../../lib/faro';
import { InteractiveStep } from './interactive-step';
import { DatasourceCheckStep as DatasourceCheckStepReal } from './datasource-check-step';
import { InteractiveGuided as InteractiveGuidedReal } from './interactive-guided';
import { InteractiveSection, resetInteractiveCounters } from './interactive-section';
import { useSectionScroll } from './hooks/use-section-scroll';

// The real `InteractiveGuided` has a required `internalActions` prop;
// the harness mock ignores it. Cast through `React.FC<any>` so the
// tripwire's `<InteractiveGuided />` JSX usage is clean.
const InteractiveGuided = InteractiveGuidedReal as unknown as React.FC<any>;
const DatasourceCheckStep = DatasourceCheckStepReal as unknown as React.FC<any>;
import {
  executeInteractiveActionCalls,
  memoryStore,
  pauseExecuteInteractiveAction,
  resetSectionHarness,
  setExecuteInteractiveActionOutcome,
  silenceSectionWarnings,
} from '../../test-utils/interactive-section-harness';

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
  it('does not route an unknown action through either the show or do branch', async () => {
    render(
      <InteractiveSection id="runner" title="Unknown action" autoCollapse={false}>
        <InteractiveStep targetAction={'unknown-action' as any} refTarget=".a">
          Unknown action
        </InteractiveStep>
      </InteractiveSection>
    );

    await waitFor(() => expect(screen.getByTestId(doSectionBtn(SECTION_ID))).toBeInTheDocument());
    act(() => {
      screen.getByTestId(doSectionBtn(SECTION_ID)).click();
    });

    await waitFor(() => expect(screen.getByTestId(resetBtn(SECTION_ID))).toBeInTheDocument());
    expect(executeInteractiveActionCalls).toHaveLength(0);
  });

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

  describe('pathfinder_do_section_button_click Faro outcome', () => {
    it('reports outcome ok for a fully completed run', async () => {
      render(
        <InteractiveSection id="runner" title="Runner" autoCollapse={false}>
          <InteractiveStep targetAction="highlight" refTarget=".a">
            Step 1
          </InteractiveStep>
        </InteractiveSection>
      );

      await waitFor(() => expect(screen.getByTestId(doSectionBtn(SECTION_ID))).toBeInTheDocument());
      act(() => {
        screen.getByTestId(doSectionBtn(SECTION_ID)).click();
      });
      await waitFor(() => expect(screen.getByTestId(resetBtn(SECTION_ID))).toBeInTheDocument());

      const { withFaroUserAction } = require('../../lib/faro');
      const sectionRunCall = withFaroUserAction.mock.calls.find(
        (c: unknown[]) => c[0] === 'pathfinder_do_section_button_click'
      );
      expect(sectionRunCall[4].outcomeFrom).toBeInstanceOf(Function);
      expect(sectionRunCall[4].outcomeFrom()).toBe('ok');
    });
  });

  describe('sequence action_error / requirements_exhausted no longer persists completion', () => {
    it('does not persist step completion when executeInteractiveAction resolves error', async () => {
      setExecuteInteractiveActionOutcome('error');
      const { events, unsubscribe } = recordEvents(['pathfinder:progress']);
      try {
        render(
          <InteractiveSection id="runner" title="Runner" autoCollapse={false}>
            <InteractiveStep targetAction="highlight" refTarget=".a">
              Step 1
            </InteractiveStep>
          </InteractiveSection>
        );

        await waitFor(() => expect(screen.getByTestId(doSectionBtn(SECTION_ID))).toBeInTheDocument());
        act(() => {
          screen.getByTestId(doSectionBtn(SECTION_ID)).click();
        });

        // Give the orchestrator a window to settle without a completion signal.
        await new Promise((resolve) => setTimeout(resolve, 200));

        const sectionCompletions = events.filter(
          (e) => e.name === 'pathfinder:progress' && e.detail.kind === 'section' && e.detail.completed
        );
        expect(sectionCompletions).toHaveLength(0);

        const persisted = memoryStore.get(`section-steps::${NON_PREVIEW_KEY}::${SECTION_ID}`) as
          Set<string> | undefined;
        expect(persisted?.has(`${SECTION_ID}-step-1`)).not.toBe(true);
      } finally {
        unsubscribe();
      }
    });

    it('reports outcome action_error (not requirements_exhausted) when executeInteractiveAction resolves error', async () => {
      setExecuteInteractiveActionOutcome('error');
      render(
        <InteractiveSection id="runner" title="Runner" autoCollapse={false}>
          <InteractiveStep targetAction="highlight" refTarget=".a">
            Step 1
          </InteractiveStep>
        </InteractiveSection>
      );

      await waitFor(() => expect(screen.getByTestId(doSectionBtn(SECTION_ID))).toBeInTheDocument());
      act(() => {
        screen.getByTestId(doSectionBtn(SECTION_ID)).click();
      });

      // Give the orchestrator a window to settle without a completion signal.
      await new Promise((resolve) => setTimeout(resolve, 200));

      // mock.calls accumulates across tests in this file — take the latest call.
      const { withFaroUserAction } = require('../../lib/faro');
      const sectionRunCalls = withFaroUserAction.mock.calls.filter(
        (c: unknown[]) => c[0] === 'pathfinder_do_section_button_click'
      );
      const sectionRunCall = sectionRunCalls[sectionRunCalls.length - 1];
      expect(sectionRunCall[4].outcomeFrom()).toBe('action_error');
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

  // `isGuided` used to be the only thing that could stop the loop. A data check
  // has no `isGuided`, and an unrecognised `targetAction` falls through
  // `executeInteractiveAction`'s default branch, which warns and then reports
  // success — so without `pausesSectionRun` the runner marks a check complete
  // that never ran, and walks straight past it.
  describe('pausesSectionRun', () => {
    it('stops the loop at a data check the same way a guided step does', async () => {
      const { events, unsubscribe } = recordEvents(['interactive-section-completed']);
      try {
        render(
          <InteractiveSection id="runner" title="Data check pause" autoCollapse={false}>
            <InteractiveStep targetAction="highlight" refTarget=".a">
              Step 1 (plain)
            </InteractiveStep>
            <DatasourceCheckStep variableName="metricsDatasource" query="up" />
            <InteractiveStep targetAction="highlight" refTarget=".c">
              Step 3 (plain)
            </InteractiveStep>
          </InteractiveSection>
        );

        await waitFor(() => expect(screen.getByTestId(doSectionBtn(SECTION_ID))).toBeInTheDocument());
        act(() => {
          screen.getByTestId(doSectionBtn(SECTION_ID)).click();
        });
        await new Promise((resolve) => setTimeout(resolve, 200));

        expect(events.filter((e) => e.name === 'interactive-section-completed')).toHaveLength(0);

        const persisted = memoryStore.get(`section-steps::${NON_PREVIEW_KEY}::${SECTION_ID}`) as
          Set<string> | undefined;
        expect(persisted).toBeDefined();
        expect(persisted!.has(`${SECTION_ID}-step-1`)).toBe(true);
        // The check itself must not be credited — only the user pressing its
        // own button can complete it.
        expect(persisted!.has(`${SECTION_ID}-datasource-check-1`)).toBe(false);
        expect(persisted!.has(`${SECTION_ID}-step-3`)).toBe(false);
      } finally {
        unsubscribe();
      }
    });
  });

  describe('cancel', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    function renderCancellableSection(requirements?: string) {
      render(
        <InteractiveSection id="runner" title="Cancel surface" autoCollapse={false} requirements={requirements}>
          <InteractiveStep targetAction="button" refTarget=".a" showMe={false}>
            Step 1
          </InteractiveStep>
          <InteractiveStep targetAction="button" refTarget=".b" showMe={false} requirements="exists-reftarget">
            Step 2
          </InteractiveStep>
        </InteractiveSection>
      );

      return {
        engine: jest.mocked(useInteractiveElements).mock.results[0]!.value as ReturnType<typeof useInteractiveElements>,
        scroll: jest.mocked(useSectionScroll).mock.results[0]!.value as ReturnType<typeof useSectionScroll>,
        actionMonitor: ActionMonitor.getInstance(),
      };
    }

    it.each<{ name: string; detail: InteractiveProgressClearedDetail; cancelAfterReset: boolean }>([
      { name: 'content reset', detail: { scope: 'content', contentKey: NON_PREVIEW_KEY }, cancelAfterReset: false },
      { name: 'global reset', detail: { scope: 'global' }, cancelAfterReset: false },
      {
        name: 'content reset followed by Cancel',
        detail: { scope: 'content', contentKey: NON_PREVIEW_KEY },
        cancelAfterReset: true,
      },
    ])(
      '$name holds the run until the pending action settles, then discards its completion',
      async ({ detail, cancelAfterReset }) => {
        const resume = pauseExecuteInteractiveAction();
        const { engine, scroll, actionMonitor } = renderCancellableSection();

        const doButton = screen.getByTestId(doSectionBtn(SECTION_ID));
        await act(async () => {
          doButton.click();
          doButton.click();
        });
        await waitFor(() => expect(executeInteractiveActionCalls).toHaveLength(1));
        expect(executeInteractiveActionCalls[0]).toEqual(
          expect.objectContaining({ refTarget: '.a', buttonType: 'do' })
        );
        expect(engine.startSectionBlocking).toHaveBeenCalledTimes(1);
        expect(actionMonitor.forceDisable).toHaveBeenCalledTimes(1);
        expect(scroll.beginProgrammaticScroll).toHaveBeenCalledTimes(1);

        act(() => dispatchInteractiveProgressCleared(detail));
        if (cancelAfterReset) {
          act(() => screen.getByRole('button', { name: 'Cancel' }).click());
        }
        act(() => screen.getByTestId(`harness-complete-${SECTION_ID}-step-1`).click());

        expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
        expect(screen.queryByTestId(doSectionBtn(SECTION_ID))).not.toBeInTheDocument();
        expect(memoryStore.get(`section-steps::${NON_PREVIEW_KEY}::${SECTION_ID}`)).toBeUndefined();
        expect(engine.stopSectionBlocking).not.toHaveBeenCalled();
        expect(actionMonitor.forceEnable).not.toHaveBeenCalled();
        expect(scroll.endProgrammaticScroll).not.toHaveBeenCalled();

        await act(async () => {
          resume();
          await jest.mocked(withFaroUserAction).mock.results[0]!.value;
        });
        await waitFor(() =>
          expect(screen.getByTestId(doSectionBtn(SECTION_ID))).toHaveTextContent('Do Section (2 steps)')
        );

        expect(executeInteractiveActionCalls).toHaveLength(1);
        expect(engine.checkRequirementsFromData).not.toHaveBeenCalled();
        expect(memoryStore.get(`section-steps::${NON_PREVIEW_KEY}::${SECTION_ID}`)).toBeUndefined();
        expect(engine.stopSectionBlocking).toHaveBeenCalledTimes(1);
        expect(engine.stopSectionBlocking).toHaveBeenCalledWith(SECTION_ID);
        expect(actionMonitor.forceEnable).toHaveBeenCalledTimes(1);
        expect(scroll.endProgrammaticScroll).toHaveBeenCalledTimes(1);
      }
    );

    it('global reset during section requirements prevents a late fix and releases startup resources once', async () => {
      const { engine, scroll, actionMonitor } = renderCancellableSection('on-page:/dashboards');
      await waitFor(() => expect(screen.getByTestId(doSectionBtn(SECTION_ID))).toBeEnabled());

      type RequirementsResult = Awaited<ReturnType<typeof engine.checkRequirementsFromData>>;
      let finishRequirements!: (result: RequirementsResult) => void;
      jest.mocked(engine.checkRequirementsFromData).mockReturnValueOnce(
        new Promise<RequirementsResult>((resolve) => {
          finishRequirements = resolve;
        })
      );

      await act(async () => screen.getByTestId(doSectionBtn(SECTION_ID)).click());
      expect(engine.checkRequirementsFromData).toHaveBeenCalledTimes(2);
      expect(actionMonitor.forceDisable).toHaveBeenCalledTimes(1);
      expect(scroll.beginProgrammaticScroll).toHaveBeenCalledTimes(1);

      act(() => dispatchInteractiveProgressCleared({ scope: 'global' }));
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
      expect(screen.queryByTestId(doSectionBtn(SECTION_ID))).not.toBeInTheDocument();
      expect(actionMonitor.forceEnable).not.toHaveBeenCalled();
      expect(scroll.endProgrammaticScroll).not.toHaveBeenCalled();

      await act(async () => {
        finishRequirements({
          requirements: 'on-page:/dashboards',
          pass: false,
          error: [
            {
              requirement: 'on-page:/dashboards',
              pass: false,
              canFix: true,
              fixType: 'location',
              targetHref: '/dashboards',
            },
          ],
        });
      });
      await waitFor(() => expect(screen.getByTestId(doSectionBtn(SECTION_ID))).toBeEnabled());

      expect(NavigationManager).toHaveBeenCalledTimes(1);
      expect(jest.mocked(NavigationManager).mock.results[0]!.value.fixLocationRequirement).not.toHaveBeenCalled();
      expect(engine.checkRequirementsFromData).toHaveBeenCalledTimes(2);
      expect(executeInteractiveActionCalls).toHaveLength(0);
      expect(engine.startSectionBlocking).not.toHaveBeenCalled();
      expect(engine.stopSectionBlocking).not.toHaveBeenCalled();
      expect(actionMonitor.forceEnable).toHaveBeenCalledTimes(1);
      expect(scroll.endProgrammaticScroll).toHaveBeenCalledTimes(1);
      expect(memoryStore.get(`section-steps::${NON_PREVIEW_KEY}::${SECTION_ID}`)).toBeUndefined();
    });

    it('Cancel retains a successful pending action so Resume starts at the next step without applying it twice', async () => {
      const resume = pauseExecuteInteractiveAction();
      const { engine, scroll, actionMonitor } = renderCancellableSection();

      await act(async () => screen.getByTestId(doSectionBtn(SECTION_ID)).click());
      await waitFor(() => expect(executeInteractiveActionCalls).toHaveLength(1));
      act(() => screen.getByRole('button', { name: 'Cancel' }).click());

      expect(screen.queryByTestId(doSectionBtn(SECTION_ID))).not.toBeInTheDocument();
      expect(engine.stopSectionBlocking).not.toHaveBeenCalled();
      expect(actionMonitor.forceEnable).not.toHaveBeenCalled();
      expect(scroll.endProgrammaticScroll).not.toHaveBeenCalled();

      await act(async () => {
        resume();
        await jest.mocked(withFaroUserAction).mock.results[0]!.value;
      });
      await waitFor(() => expect(screen.getByTestId(doSectionBtn(SECTION_ID))).toHaveTextContent('Resume (1 step)'));

      expect(memoryStore.get(`section-steps::${NON_PREVIEW_KEY}::${SECTION_ID}`)).toEqual(
        new Set([`${SECTION_ID}-step-1`])
      );
      expect(executeInteractiveActionCalls).toHaveLength(1);
      expect(engine.checkRequirementsFromData).not.toHaveBeenCalled();
      expect(engine.stopSectionBlocking).toHaveBeenCalledTimes(1);
      expect(actionMonitor.forceEnable).toHaveBeenCalledTimes(1);
      expect(scroll.endProgrammaticScroll).toHaveBeenCalledTimes(1);

      await act(async () => screen.getByTestId(doSectionBtn(SECTION_ID)).click());
      await waitFor(() => expect(screen.getByTestId(resetBtn(SECTION_ID))).toBeInTheDocument());

      expect(executeInteractiveActionCalls).toEqual([
        expect.objectContaining({ refTarget: '.a', buttonType: 'do' }),
        expect.objectContaining({ refTarget: '.b', buttonType: 'do' }),
      ]);
      expect(memoryStore.get(`section-steps::${NON_PREVIEW_KEY}::${SECTION_ID}`)).toEqual(
        new Set([`${SECTION_ID}-step-1`, `${SECTION_ID}-step-2`])
      );
    });
  });

  describe('requirements priority logic (gate criteria — not yet implemented)', () => {
    it.todo('requirement-fix-recheck-passes: failing requirement is fixed, recheck passes, step executes');
    it.todo('requirement-fix-recheck-fails-skippable: skippable step is marked skipped and loop continues');
    it.todo('requirement-fix-fails-not-skippable: stoppedDueToRequirements=true, no further steps');
    it.todo('section-level requirements fail and cannot be fixed: handleDoSection returns immediately');
  });
});
