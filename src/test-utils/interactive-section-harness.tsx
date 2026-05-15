/**
 * Shared test harness for InteractiveSection state machine tests.
 *
 * The section pulls in `@grafana/ui`, `@grafana/data`, the interactive engine,
 * the requirements manager, the docs-retrieval barrel, the user-storage layer,
 * and seven step component modules. None of those are part of the section's
 * reducer-shaped behaviour. This harness centralises the minimal mock surface
 * so each test file can focus on transitions, not plumbing.
 *
 * Usage pattern (jest.mock factories must be at the top of the test file —
 * they're hoisted, so they can't close over imports; they `require` the
 * harness lazily):
 *
 * ```ts
 * jest.mock('../../lib/user-storage', () => {
 *   // eslint-disable-next-line @typescript-eslint/no-require-imports
 *   return require('../../test-utils/interactive-section-harness').createUserStorageMock();
 * });
 * jest.mock('../interactive-tutorial/interactive-step', () => {
 *   // eslint-disable-next-line @typescript-eslint/no-require-imports
 *   return require('../../test-utils/interactive-section-harness').createInteractiveStepMock();
 * });
 * ```
 *
 * `memoryStore` is the single in-memory backing store shared between all
 * storage namespaces. Reset it in `beforeEach` via `resetSectionHarness()`.
 */

import React from 'react';

export const memoryStore = new Map<string, unknown>();

/** Configurable return value for `checkRequirementsFromData`. Override per-test
 *  via `setCheckRequirementsResult()`; reset in `resetSectionHarness()`. */
let _checkRequirementsResult: {
  pass: boolean;
  error?: Array<{ requirement?: string; error?: string; canFix?: boolean; fixType?: string; targetHref?: string }>;
} = {
  pass: true,
  error: [],
};

export function setCheckRequirementsResult(result: typeof _checkRequirementsResult) {
  _checkRequirementsResult = result;
}

const stepsKey = (contentKey: string, sectionId: string) => `section-steps::${contentKey}::${sectionId}`;
const collapseKey = (contentKey: string, sectionId: string) => `section-collapse::${contentKey}::${sectionId}`;
const ackKey = (contentKey: string, sectionId: string) => `section-ack::${contentKey}::${sectionId}`;
const completionKey = (contentKey: string) => `interactive-completion::${contentKey}`;

/** Sweep all harness keys for a content key (matches the real
 *  `clearAllForContent` contract — sweeps steps + collapse + ack). */
function sweepContent(contentKey: string) {
  for (const k of Array.from(memoryStore.keys())) {
    if (typeof k !== 'string') {
      continue;
    }
    if (
      k.startsWith(`section-steps::${contentKey}::`) ||
      k.startsWith(`section-collapse::${contentKey}::`) ||
      k.startsWith(`section-ack::${contentKey}::`)
    ) {
      memoryStore.delete(k);
    }
  }
}

/** Factory for `jest.mock('../../lib/user-storage', ...)`. */
export function createUserStorageMock() {
  return {
    interactiveStepStorage: {
      getCompleted: jest.fn(async (contentKey: string, sectionId: string) => {
        const v = memoryStore.get(stepsKey(contentKey, sectionId));
        return v ? new Set(v as Set<string>) : new Set<string>();
      }),
      setCompleted: jest.fn(async (contentKey: string, sectionId: string, ids: Set<string>) => {
        memoryStore.set(stepsKey(contentKey, sectionId), new Set(ids));
      }),
      clear: jest.fn(async (contentKey: string, sectionId: string) => {
        memoryStore.delete(stepsKey(contentKey, sectionId));
      }),
      countAllCompleted: jest.fn(() => 0),
      hasProgress: jest.fn(async (contentKey: string) => {
        for (const k of memoryStore.keys()) {
          if (typeof k === 'string' && k.startsWith(`section-steps::${contentKey}::`)) {
            const v = memoryStore.get(k) as Set<string> | undefined;
            if (v && v.size > 0) {
              return true;
            }
          }
        }
        return false;
      }),
      clearAllForContent: jest.fn(async (contentKey: string) => {
        sweepContent(contentKey);
      }),
      clearAll: jest.fn(async () => {
        memoryStore.clear();
      }),
    },
    sectionCollapseStorage: {
      get: jest.fn(async (contentKey: string, sectionId: string) => {
        return (memoryStore.get(collapseKey(contentKey, sectionId)) as boolean) ?? false;
      }),
      set: jest.fn(async (contentKey: string, sectionId: string, value: boolean) => {
        memoryStore.set(collapseKey(contentKey, sectionId), value);
      }),
      clear: jest.fn(async (contentKey: string, sectionId: string) => {
        memoryStore.delete(collapseKey(contentKey, sectionId));
      }),
    },
    /** Pre-wired for the post-#842 storage namespace. The real export lands in
     *  Phase 2; including it in the harness from day one means test files don't
     *  need to change between phases. */
    sectionAcknowledgementStorage: {
      get: jest.fn(async (contentKey: string, sectionId: string) => {
        const v = memoryStore.get(ackKey(contentKey, sectionId));
        return v === undefined ? null : (v as boolean);
      }),
      set: jest.fn(async (contentKey: string, sectionId: string, value: boolean) => {
        memoryStore.set(ackKey(contentKey, sectionId), value);
      }),
      clear: jest.fn(async (contentKey: string, sectionId: string) => {
        memoryStore.delete(ackKey(contentKey, sectionId));
      }),
    },
    interactiveCompletionStorage: {
      set: jest.fn(async (contentKey: string, value: number) => {
        memoryStore.set(completionKey(contentKey), value);
      }),
      clear: jest.fn(async (contentKey: string) => {
        memoryStore.delete(completionKey(contentKey));
      }),
    },
  };
}

/** Step-stub component. Surfaces `onStepComplete` / `onStepReset` as plain
 *  buttons so tests can drive the section's reducer directly, bypassing the
 *  real step component's action-execution pipeline. */
interface StepStubProps {
  stepId?: string;
  onStepComplete?: (stepId: string) => void;
  onStepReset?: (stepId: string) => void;
  targetAction?: string;
  refTarget?: string;
  children?: React.ReactNode;
}

const StepStub: React.FC<StepStubProps> = ({ stepId, onStepComplete, onStepReset, children }) =>
  React.createElement(
    'div',
    { 'data-testid': `step-stub-${stepId ?? 'anon'}` },
    React.createElement('span', null, children),
    React.createElement(
      'button',
      {
        'data-testid': `harness-complete-${stepId ?? 'anon'}`,
        onClick: () => stepId && onStepComplete?.(stepId),
      },
      'Harness: complete step'
    ),
    React.createElement(
      'button',
      {
        'data-testid': `harness-redo-${stepId ?? 'anon'}`,
        onClick: () => stepId && onStepReset?.(stepId),
      },
      'Harness: redo step'
    )
  );

/** Factory for `jest.mock('.../interactive-step', ...)`. */
export function createInteractiveStepMock() {
  return {
    InteractiveStep: StepStub,
    resetStepCounter: jest.fn(),
  };
}

/** Factory for the sibling step-component modules. The section's
 *  `stepComponents` `useMemo` does identity checks against each of these
 *  component types; mocking them as inert stand-ins keeps the section's
 *  classifier honest. */
export function createInteractiveMultiStepMock() {
  return { InteractiveMultiStep: () => null, resetMultiStepCounter: jest.fn() };
}
export function createInteractiveGuidedMock() {
  return { InteractiveGuided: () => null, resetGuidedCounter: jest.fn() };
}
export function createInteractiveQuizMock() {
  return { InteractiveQuiz: () => null, resetQuizCounter: jest.fn() };
}
export function createTerminalStepMock() {
  return { TerminalStep: () => null, resetTerminalStepCounter: jest.fn() };
}
export function createTerminalConnectStepMock() {
  return { TerminalConnectStep: () => null, resetTerminalConnectStepCounter: jest.fn() };
}
export function createCodeBlockStepMock() {
  return { CodeBlockStep: () => null, resetCodeBlockStepCounter: jest.fn() };
}
export function createInteractiveConditionalMock() {
  return { InteractiveConditional: () => null };
}

/** Factory for `jest.mock('../../interactive-engine', ...)`. */
export function createInteractiveEngineMock() {
  // checkRequirementsFromData must be a stable reference — if it changes identity
  // on every render (because useInteractiveElements returns a new jest.fn() each
  // call), the section's useCallback dependency changes and the requirements-check
  // effect re-fires indefinitely, causing OOM in tests with requirements set.
  const stableCheckRequirementsFromData = jest.fn(async () => _checkRequirementsResult);
  return {
    useInteractiveElements: () => ({
      executeInteractiveAction: jest.fn(async () => undefined),
      startSectionBlocking: jest.fn(),
      stopSectionBlocking: jest.fn(),
      verifyStepResult: jest.fn(async () => true),
      checkRequirementsFromData: stableCheckRequirementsFromData,
    }),
    ActionMonitor: {
      getInstance: () => ({
        enable: jest.fn(),
        forceEnable: jest.fn(),
        forceDisable: jest.fn(),
      }),
    },
    NavigationManager: jest.fn().mockImplementation(() => ({
      clearAllHighlights: jest.fn(),
      fixNavigationRequirements: jest.fn().mockResolvedValue(undefined),
      fixLocationRequirement: jest.fn().mockResolvedValue(undefined),
      expandParentNavigationSection: jest.fn().mockResolvedValue(undefined),
    })),
  };
}

/** Factory for `jest.mock('../../requirements-manager', ...)`. */
export function createRequirementsManagerMock() {
  return {
    useStepChecker: () => ({
      isEnabled: true,
      isCompleted: false,
      explanation: null,
      completionReason: 'none',
      canSkip: false,
      markSkipped: jest.fn(),
      resetStep: jest.fn(),
    }),
    SequentialRequirementsManager: {
      getInstance: () => ({
        triggerReactiveCheck: jest.fn(),
        watchNextStep: jest.fn(),
        startDOMMonitoring: jest.fn(),
        stopDOMMonitoring: jest.fn(),
        updateStep: jest.fn(),
      }),
    },
    validateInteractiveRequirements: jest.fn(),
    getRequirementExplanation: jest.fn((requirement?: string) => {
      if (requirement?.startsWith('on-page:')) {
        return 'Navigate to the correct page first.';
      }
      return 'Requirements not yet met.';
    }),
  };
}

/** Factory for `jest.mock('../../docs-retrieval', ...)`. */
export function createDocsRetrievalMock() {
  return {
    ImageRenderer: () => null,
    VideoRenderer: () => null,
    YouTubeVideoRenderer: () => null,
  };
}

/** Factory for `jest.mock('../../global-state/alignment-pending-context', ...)`. */
export function createAlignmentContextMock() {
  return {
    useIsAlignmentPaused: () => false,
    useAlignmentStartingLocation: () => null,
  };
}

/** Factory for `jest.mock('../../lib/analytics', ...)`. */
export function createAnalyticsMock() {
  return {
    reportAppInteraction: jest.fn(),
    UserInteraction: {
      DoSectionButtonClick: 'do_section',
      ShowMeButtonClick: 'show_me',
      DoItButtonClick: 'do_it',
      StepAutoCompleted: 'auto',
    },
    getSourceDocument: jest.fn(() => ({})),
    calculateStepCompletion: jest.fn(() => undefined),
  };
}

/** Factory for `jest.mock('../../constants', ...)`. */
export function createConstantsMock() {
  return {
    getConfigWithDefaults: jest.fn(() => ({})),
  };
}

/** Factory for `jest.mock('../../constants/interactive-config', ...)`. */
export function createInteractiveConfigMock() {
  return {
    getInteractiveConfig: jest.fn(() => ({
      autoDetection: { enabled: false },
      delays: { section: { baseInterval: 0, showPhaseIterations: 0, betweenStepsIterations: 0 } },
    })),
    INTERACTIVE_CONFIG: {
      delays: { section: { baseInterval: 0, showPhaseIterations: 0, betweenStepsIterations: 0 } },
    },
  };
}

/** Reset the in-memory store between tests. Call from `beforeEach`. */
export function resetSectionHarness() {
  memoryStore.clear();
  _checkRequirementsResult = { pass: true, error: [] };
}

/**
 * Suppress noisy section-internal `console.warn` lines (the [Section] scroll
 * listener firehose, plus any `[SECTION-DEBUG]` instrumentation). Keep real
 * warnings visible.
 */
export function silenceSectionWarnings(): jest.SpyInstance {
  const real = console.warn.bind(console);
  return jest.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    const first = args[0];
    if (typeof first === 'string' && (first.startsWith('[Section]') || first.startsWith('[SECTION-DEBUG]'))) {
      return;
    }
    real(...args);
  });
}
