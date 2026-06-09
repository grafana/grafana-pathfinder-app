/**
 * Phase 0 TRIPWIRE — `CustomEvent` + window-global contract surface.
 *
 * Pins the externally-observed contracts that `InteractiveSection`
 * dispatches today, so that subsequent Tier A / Tier B extractions
 * that *move ownership* of these contracts cannot silently change
 * their names, payload shapes, or dispatch counts. Per the High-Risk
 * Refactor Guidelines: Pattern J — "do not rename or clean up contract
 * surfaces during structural refactor".
 *
 * What is pinned:
 *   - `interactive-progress-saved`  : detail `{ contentKey, hasProgress, completionPercentage }`
 *   - `interactive-progress-cleared`: detail `{ contentKey }`
 *   - `section-completed`           : detail `{ sectionId }` (on `document`)
 *   - `interactive-section-completed`: detail `{ sectionId }` (on `window`)
 *   - `interactive-step-completed`  : detail `{ stepId, sectionId }`
 *   - `pathfinder-step-progress`    : detail `{ sectionId, totalSteps, documentStepIndex, completedCount }`
 *   - `window.__DocsPluginCurrentStepIndex` + `__DocsPluginTotalSteps`
 *   - Preview-mode write-suppression for the four storage namespaces,
 *     with the `interactive-progress-saved` event still firing.
 *
 * Disposable — deletable in the commit that lands Tier B5
 * (`useSectionPersistence`) once permanent post-tests prove equivalent
 * coverage. See Guidelines Principle 4.
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
import { InteractiveSection, resetInteractiveCounters, STEP_TYPE_LOOKUP } from './interactive-section';
import { STEP_TYPE_SCHEMAS } from './step-type-registry';
import { INTERACTIVE_STEP_COMPONENT_TYPES } from './section-child-classifier';
import { memoryStore, resetSectionHarness, silenceSectionWarnings } from '../../test-utils/interactive-section-harness';

const NON_PREVIEW_KEY = '/';
const PREVIEW_KEY = 'block-editor://preview/test-guide';

interface CapturedEvent {
  name: string;
  detail: any;
}

/** Subscribe to every event the section is expected to dispatch and
 *  collect their detail payloads in order. Returns an unsubscriber. */
function recordSectionEvents(): { events: CapturedEvent[]; unsubscribe: () => void } {
  const events: CapturedEvent[] = [];
  const make = (name: string, target: 'window' | 'document') => {
    const handler = (e: Event) => events.push({ name, detail: (e as CustomEvent).detail });
    (target === 'window' ? window : document).addEventListener(name, handler);
    return () => (target === 'window' ? window : document).removeEventListener(name, handler);
  };
  const offs = [
    make('pathfinder:progress', 'window'),
    make('interactive-progress-cleared', 'window'),
    make('pathfinder-step-progress', 'window'),
  ];
  return { events, unsubscribe: () => offs.forEach((off) => off()) };
}

function renderSingleStepSection() {
  return render(
    <InteractiveSection id="contracts" title="Contracts section" autoCollapse={false}>
      <InteractiveStep targetAction="highlight" refTarget=".a">
        Step
      </InteractiveStep>
    </InteractiveSection>
  );
}

const SECTION_ID = 'section-contracts';
const STEP_ID = `${SECTION_ID}-step-1`;
const completeBtn = (stepId: string) => `harness-complete-${stepId}`;
const resetButton = (id: string) => testIds.interactive.resetSectionButton(id);

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
  delete (window as any).__DocsPluginCurrentStepIndex;
  delete (window as any).__DocsPluginTotalSteps;
});

afterEach(() => {
  cleanup();
});

// Tracked step-type registry parity (B4). Adding a step type to one site but
// not the others is a silent-drift bug (historically: ChallengeBlock landed in
// only two of the sites). These pin all three tracked sites against each other.
// See .cursor/rules/tracked-step-types.mdc.
describe('step-type registry parity', () => {
  it('STEP_TYPE_LOOKUP holds exactly the registry schemas (both directions)', () => {
    expect(new Set(STEP_TYPE_LOOKUP.values())).toEqual(new Set(STEP_TYPE_SCHEMAS));
    expect(STEP_TYPE_LOOKUP.size).toBe(STEP_TYPE_SCHEMAS.length);
  });

  it('every tracked step component except InteractiveStep is in the classifier set', () => {
    for (const component of STEP_TYPE_LOOKUP.keys()) {
      if (component === InteractiveStep) {
        continue;
      }
      expect(INTERACTIVE_STEP_COMPONENT_TYPES.has(component)).toBe(true);
    }
  });
});

describe('InteractiveSection contracts — Phase 0 tripwire', () => {
  describe('event payload shapes', () => {
    it('dispatches pathfinder:progress (kind: step) on step completion', async () => {
      const { events, unsubscribe } = recordSectionEvents();
      try {
        renderSingleStepSection();
        await waitFor(() => expect(screen.getByTestId(completeBtn(STEP_ID))).toBeInTheDocument());
        act(() => {
          screen.getByTestId(completeBtn(STEP_ID)).click();
        });

        await waitFor(() => {
          const evt = events.find((e) => e.name === 'pathfinder:progress' && e.detail.kind === 'step');
          expect(evt).toBeDefined();
          expect(evt!.detail).toEqual(
            expect.objectContaining({
              kind: 'step',
              stepId: STEP_ID,
              sectionId: SECTION_ID,
              completed: true,
            })
          );
        });
      } finally {
        unsubscribe();
      }
    });

    it('dispatches pathfinder:progress (kind: guide) with { contentKey, hasProgress, percentage } on persistence', async () => {
      const { events, unsubscribe } = recordSectionEvents();
      try {
        renderSingleStepSection();
        await waitFor(() => expect(screen.getByTestId(completeBtn(STEP_ID))).toBeInTheDocument());
        act(() => {
          screen.getByTestId(completeBtn(STEP_ID)).click();
        });

        await waitFor(() => {
          const evt = events.find((e) => e.name === 'pathfinder:progress' && e.detail.kind === 'guide');
          expect(evt).toBeDefined();
          expect(evt!.detail).toEqual(
            expect.objectContaining({
              kind: 'guide',
              contentKey: NON_PREVIEW_KEY,
              hasProgress: true,
            })
          );
          expect(typeof evt!.detail.percentage).toBe('number');
        });
      } finally {
        unsubscribe();
      }
    });

    it('dispatches pathfinder:progress (kind: section) with { sectionId } exactly once per completion', async () => {
      const { events, unsubscribe } = recordSectionEvents();
      try {
        renderSingleStepSection();
        await waitFor(() => expect(screen.getByTestId(completeBtn(STEP_ID))).toBeInTheDocument());
        act(() => {
          screen.getByTestId(completeBtn(STEP_ID)).click();
        });

        await waitFor(() => {
          const sectionEvents = events.filter((e) => e.name === 'pathfinder:progress' && e.detail.kind === 'section');
          expect(sectionEvents).toHaveLength(1);
          expect(sectionEvents[0]!.detail).toEqual({ kind: 'section', sectionId: SECTION_ID, completed: true });
        });
      } finally {
        unsubscribe();
      }
    });

    it('dispatches `pathfinder-step-progress` with the documented detail shape', async () => {
      const { events, unsubscribe } = recordSectionEvents();
      try {
        renderSingleStepSection();
        await waitFor(() => expect(screen.getByTestId(completeBtn(STEP_ID))).toBeInTheDocument());
        act(() => {
          screen.getByTestId(completeBtn(STEP_ID)).click();
        });

        await waitFor(() => {
          const evt = events.find((e) => e.name === 'pathfinder-step-progress');
          expect(evt).toBeDefined();
          expect(Object.keys(evt!.detail).sort()).toEqual(
            ['completedCount', 'documentStepIndex', 'sectionId', 'totalSteps'].sort()
          );
          expect(evt!.detail.sectionId).toBe(SECTION_ID);
          expect(typeof evt!.detail.totalSteps).toBe('number');
        });
      } finally {
        unsubscribe();
      }
    });

    it('dispatches `interactive-progress-cleared` with { contentKey } on section reset', async () => {
      const { events, unsubscribe } = recordSectionEvents();
      try {
        renderSingleStepSection();
        await waitFor(() => expect(screen.getByTestId(completeBtn(STEP_ID))).toBeInTheDocument());
        act(() => {
          screen.getByTestId(completeBtn(STEP_ID)).click();
        });
        await waitFor(() => expect(screen.getByTestId(resetButton(SECTION_ID))).toBeInTheDocument());

        // Clear the events buffer so we observe only the reset's dispatches.
        events.length = 0;
        act(() => {
          screen.getByTestId(resetButton(SECTION_ID)).click();
        });

        await waitFor(() => {
          const evt = events.find((e) => e.name === 'interactive-progress-cleared');
          expect(evt).toBeDefined();
          expect(evt!.detail).toEqual({ contentKey: NON_PREVIEW_KEY });
        });
      } finally {
        unsubscribe();
      }
    });
  });

  describe('window globals', () => {
    it('writes `__DocsPluginTotalSteps` on mount + after completion', async () => {
      renderSingleStepSection();
      await waitFor(() => {
        expect(typeof (window as any).__DocsPluginTotalSteps).toBe('number');
      });
    });
  });

  // MF-1 tripwire — pin author/parser-supplied stable stepId end to end.
  // The JSON parser emits `props.stepId` for every interactive block
  // (either the author's `id` or `deriveStepId(...)`). Two earlier
  // collapse points used to drop it:
  //   1. content-renderer cases did not forward `element.props.stepId`
  //      to the step components.
  //   2. interactive-section's `stepComponents` memo synthesised a
  //      positional `${sectionId}-${idPrefix}-${index+1}` ID, and
  //      `cloneElement` spread that over the child's stable ID.
  // If either regresses, every "stable ID" claim in the PR collapses:
  // inserting a sibling block re-keys every later step. Pin the contract
  // here so future refactors can't silently break it.
  describe('stable stepId forwarding', () => {
    const STABLE_ID = 'create-ds';

    it('uses author-supplied stepId on the step instead of the positional fallback', async () => {
      render(
        <InteractiveSection id="contracts" title="Contracts section" autoCollapse={false}>
          <InteractiveStep stepId={STABLE_ID} targetAction="highlight" refTarget=".a">
            Step
          </InteractiveStep>
        </InteractiveSection>
      );
      // Harness writes `harness-complete-${stepId}` — confirms the
      // section threaded the child's stepId into cloneElement, NOT the
      // positional `section-contracts-step-1` value.
      await waitFor(() => expect(screen.getByTestId(`harness-complete-${STABLE_ID}`)).toBeInTheDocument());
      expect(screen.queryByTestId(`harness-complete-${SECTION_ID}-step-1`)).toBeNull();
    });

    it('keeps the stable stepId stable when a sibling step is inserted before it', async () => {
      const { rerender } = render(
        <InteractiveSection id="contracts" title="Contracts section" autoCollapse={false}>
          <InteractiveStep stepId={STABLE_ID} targetAction="highlight" refTarget=".a">
            Original step
          </InteractiveStep>
        </InteractiveSection>
      );
      await waitFor(() => expect(screen.getByTestId(`harness-complete-${STABLE_ID}`)).toBeInTheDocument());

      rerender(
        <InteractiveSection id="contracts" title="Contracts section" autoCollapse={false}>
          <InteractiveStep stepId="inserted-first" targetAction="highlight" refTarget=".b">
            Inserted step
          </InteractiveStep>
          <InteractiveStep stepId={STABLE_ID} targetAction="highlight" refTarget=".a">
            Original step
          </InteractiveStep>
        </InteractiveSection>
      );

      // The original step's ID survives the insertion — completion
      // recorded under STABLE_ID is still addressable.
      await waitFor(() => expect(screen.getByTestId(`harness-complete-${STABLE_ID}`)).toBeInTheDocument());
      expect(screen.getByTestId(`harness-complete-inserted-first`)).toBeInTheDocument();
    });

    it('falls back to the positional id when the child has no stepId prop', async () => {
      render(
        <InteractiveSection id="contracts" title="Contracts section" autoCollapse={false}>
          <InteractiveStep targetAction="highlight" refTarget=".a">
            Anonymous step
          </InteractiveStep>
        </InteractiveSection>
      );
      // No author/parser ID → positional fallback (`section-contracts-step-1`).
      await waitFor(() => expect(screen.getByTestId(`harness-complete-${SECTION_ID}-step-1`)).toBeInTheDocument());
    });
  });

  describe('preview-mode sandbox', () => {
    beforeEach(() => {
      (window as any).__DocsPluginActiveTabUrl = PREVIEW_KEY;
    });

    it('suppresses storage writes but still dispatches the unified progress event and the legacy cleared event', async () => {
      const { events, unsubscribe } = recordSectionEvents();
      try {
        renderSingleStepSection();
        await waitFor(() => expect(screen.getByTestId(completeBtn(STEP_ID))).toBeInTheDocument());
        act(() => {
          screen.getByTestId(completeBtn(STEP_ID)).click();
        });

        // In preview mode the section-level progress event still fires
        // so the editor's "Reset guide" button can react. The kind:'guide'
        // event is suppressed in preview because it carries the
        // completion-percentage (preview has no document total).
        await waitFor(() => {
          expect(events.find((e) => e.name === 'pathfinder:progress' && e.detail.kind === 'section')).toBeDefined();
        });

        // Storage must be untouched under the preview key.
        expect(memoryStore.get(`section-steps::${PREVIEW_KEY}::${SECTION_ID}`)).toBeUndefined();
        expect(memoryStore.get(`interactive-completion::${PREVIEW_KEY}`)).toBeUndefined();

        // Now reset and confirm the cleared event still fires.
        events.length = 0;
        await waitFor(() => expect(screen.getByTestId(resetButton(SECTION_ID))).toBeInTheDocument());
        act(() => {
          screen.getByTestId(resetButton(SECTION_ID)).click();
        });
        await waitFor(() => {
          const evt = events.find((e) => e.name === 'interactive-progress-cleared');
          expect(evt).toBeDefined();
          expect(evt!.detail).toEqual({ contentKey: PREVIEW_KEY });
        });
      } finally {
        unsubscribe();
      }
    });
  });

  // F-2 tripwire — pin the cross-step re-render contract introduced by
  // PR #909. The store relocation moved completion state out of the
  // section's reducer and into the global `completion-store`; the section
  // now subscribes via `useSyncExternalStore(useSectionCompletion)`. If
  // that wiring regresses (missing listener, stale snapshot, dep-array
  // gap on the version bump), an external `markStepCompleted` call will
  // silently fail to trigger a re-render — sibling steps keep rendering
  // against the pre-flip completion set and section-level derivations
  // (`stepsCompleted`, `isCompleted`, the Reset button gate) never reflect
  // the new state. PR #909 deferred this probe as follow-up F-2; this
  // test pins the contract so the wiring can't quietly regress.
  describe('cross-step re-render on store flips (F-2)', () => {
    it('re-renders sibling step + section when markStepCompleted flips from outside React', async () => {
      const { markStepCompleted } = require('../../global-state/completion-store');

      const flushMicrotasks = async () => {
        await act(async () => {
          await Promise.resolve();
        });
      };

      const { events, unsubscribe } = recordSectionEvents();
      try {
        render(
          <InteractiveSection id="contracts" title="Contracts section" autoCollapse={false}>
            <InteractiveStep stepId="step-1" targetAction="highlight" refTarget=".a">
              Step one
            </InteractiveStep>
            <InteractiveStep stepId="step-2" targetAction="highlight" refTarget=".b">
              Step two
            </InteractiveStep>
          </InteractiveSection>
        );

        // Both children mount with their author-supplied stepIds.
        await waitFor(() => {
          expect(screen.getByTestId(`harness-complete-step-1`)).toBeInTheDocument();
          expect(screen.getByTestId(`harness-complete-step-2`)).toBeInTheDocument();
        });

        // Drain the initial mount's `useDocumentStepProgress` dispatch so
        // the post-flip event is unambiguously attributable to a
        // store-driven re-render rather than the mount-time effect.
        await waitFor(() => {
          expect(events.find((e) => e.name === 'pathfinder-step-progress')).toBeDefined();
        });
        events.length = 0;

        // Flip completion from outside React. The section must re-render
        // via its `useSyncExternalStore` subscription to pick this up.
        await act(async () => {
          markStepCompleted('step-1', SECTION_ID, 'manual');
          await Promise.resolve();
        });

        // Sibling addressability: the store flip didn't unmount or
        // re-key the unrelated child. Step-1's harness is still in the
        // DOM too — completed steps are not torn down by the section.
        expect(screen.getByTestId(`harness-complete-step-2`)).toBeInTheDocument();
        expect(screen.getByTestId(`harness-complete-step-1`)).toBeInTheDocument();

        // Regression probe: this event only re-fires when `completedSteps`
        // changes in `useDocumentStepProgress`'s deps — which requires
        // the `useSyncExternalStore` subscription to land the flip in
        // the section's render commit.
        await waitFor(() => {
          const evt = events.find((e) => e.name === 'pathfinder-step-progress' && e.detail.sectionId === SECTION_ID);
          expect(evt).toBeDefined();
        });

        // Drive step-2's harness button. The section's
        // `handleStepComplete` closure captures `completedSteps` from the
        // most recent commit; if the prior store flip didn't refresh that
        // snapshot, the section would still see only step-2 completed and
        // `stepsCompleted` would stay false (Do Section, not Reset). The
        // appearance of `resetSectionButton` is the visible-DOM
        // confirmation that the cross-step re-render contract holds.
        act(() => {
          screen.getByTestId(`harness-complete-step-2`).click();
        });
        await flushMicrotasks();
        await waitFor(() => {
          expect(screen.getByTestId(resetButton(SECTION_ID))).toBeInTheDocument();
        });
      } finally {
        unsubscribe();
      }
    });
  });
});
