/**
 * Phase 0 TRIPWIRE — `stepComponents` ↔ `enhancedChildren` symmetry.
 *
 * `InteractiveSection` currently maintains two parallel `switch-on-
 * component-type` chains:
 *   - `stepComponents` useMemo (lines ~477–610) — builds `StepInfo` records.
 *   - `enhancedChildren` useMemo (lines ~1631–1907) — clones each child
 *     with type-specific enhanced props.
 *
 * Tier A4 collapses both into a single table-driven loop keyed on
 * `STEP_TYPE_REGISTRY` (`step-type-registry.ts`). This tripwire fires
 * before that move and asserts the per-type enhanced-prop surface,
 * so the table-driven version cannot silently change which props each
 * step type receives. Per the High-Risk Refactor Guidelines:
 * Pattern E — interface-first component extraction.
 *
 * Disposable — deletable in the same commit as Tier A4 once the
 * collapsed loop is in place and equivalent assertions live in the
 * registry's own unit tests.
 *
 * Note on `ref` and `key`: React strips these from `props` before
 * passing them to the child component, so we observe them via
 * presence-based assertions only where they materially affect the
 * test (e.g. by inspecting `React.Children.map` output via spy).
 * The forwardable-prop surface is fully observable.
 */

import React from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';

// ─── Inline prop-capturing mocks ────────────────────────────────────────────
//
// Each tracked step component type captures the props it was rendered
// with into a shared map. Tests then inspect that map to verify the
// per-type enhanced-prop surface.
const captures = new Map<string, any[]>();
function makeCapture(name: string): React.FC<any> {
  return (props: any) => {
    // React 18 dev-mode `validateFunctionComponentInDev` may invoke the
    // component once with `undefined` to introspect it (especially when
    // a `ref` callback is attached to a non-`forwardRef` function). Skip
    // those probe calls so the bucket only contains real render props.
    if (props === undefined) {
      return null;
    }
    let bucket = captures.get(name);
    if (!bucket) {
      bucket = [];
      captures.set(name, bucket);
    }
    bucket.push(props);
    return null;
  };
}

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

// Step-type mocks — prop-capturing. Each module preserves the
// `reset...Counter` named export the section imports at the top of the
// file; the actual reset is irrelevant here, just present.
jest.mock('./interactive-step', () => ({
  InteractiveStep: makeCapture('InteractiveStep'),
  resetStepCounter: jest.fn(),
}));
jest.mock('./interactive-multi-step', () => ({
  InteractiveMultiStep: makeCapture('InteractiveMultiStep'),
  resetMultiStepCounter: jest.fn(),
}));
jest.mock('./interactive-guided', () => ({
  InteractiveGuided: makeCapture('InteractiveGuided'),
  resetGuidedCounter: jest.fn(),
}));
jest.mock('./interactive-quiz', () => ({
  InteractiveQuiz: makeCapture('InteractiveQuiz'),
  resetQuizCounter: jest.fn(),
}));
jest.mock('./terminal-step', () => ({
  TerminalStep: makeCapture('TerminalStep'),
  resetTerminalStepCounter: jest.fn(),
}));
jest.mock('./terminal-connect-step', () => ({
  TerminalConnectStep: makeCapture('TerminalConnectStep'),
  resetTerminalConnectStepCounter: jest.fn(),
}));
jest.mock('./code-block-step', () => ({
  CodeBlockStep: makeCapture('CodeBlockStep'),
  resetCodeBlockStepCounter: jest.fn(),
}));
jest.mock('./interactive-conditional', () => ({ InteractiveConditional: () => null }));

import { InteractiveStep as InteractiveStepReal } from './interactive-step';
import { InteractiveMultiStep as InteractiveMultiStepReal } from './interactive-multi-step';
import { InteractiveGuided as InteractiveGuidedReal } from './interactive-guided';
import { InteractiveQuiz as InteractiveQuizReal } from './interactive-quiz';
import { TerminalStep as TerminalStepReal } from './terminal-step';
import { TerminalConnectStep as TerminalConnectStepReal } from './terminal-connect-step';
import { CodeBlockStep as CodeBlockStepReal } from './code-block-step';
import { InteractiveSection, resetInteractiveCounters } from './interactive-section';

// The real types of each step component require domain-specific props
// (`internalActions`, `command`, `question`, etc.) that our mocks don't
// consume. Re-alias them as `React.FC<any>` so JSX usage in this test
// file doesn't carry runtime-irrelevant prop noise.
const InteractiveStep = InteractiveStepReal as unknown as React.FC<any>;
const InteractiveMultiStep = InteractiveMultiStepReal as unknown as React.FC<any>;
const InteractiveGuided = InteractiveGuidedReal as unknown as React.FC<any>;
const InteractiveQuiz = InteractiveQuizReal as unknown as React.FC<any>;
const TerminalStep = TerminalStepReal as unknown as React.FC<any>;
const TerminalConnectStep = TerminalConnectStepReal as unknown as React.FC<any>;
const CodeBlockStep = CodeBlockStepReal as unknown as React.FC<any>;
import { resetSectionHarness, silenceSectionWarnings } from '../../test-utils/interactive-section-harness';

let warnSpy: jest.SpyInstance;
beforeAll(() => {
  warnSpy = silenceSectionWarnings();
});
afterAll(() => {
  warnSpy.mockRestore();
});

beforeEach(() => {
  captures.clear();
  resetSectionHarness();
  resetInteractiveCounters();
  (window as any).__DocsPluginActiveTabUrl = undefined;
});

afterEach(() => {
  cleanup();
});

/**
 * Expected enhanced-prop surface per tracked step type. Drawn from the
 * cloneElement call sites in `enhancedChildren` (lines ~1657, 1699,
 * 1745, 1790, 1820, 1850, 1881).
 *
 * `ref` and `key` are intentionally excluded — React handles them
 * specially and they do not appear in the captured `props`.
 */
const COMMON_PROPS = [
  'stepId',
  'isEligibleForChecking',
  'isCompleted',
  'onStepComplete',
  'stepIndex',
  'totalSteps',
  'sectionId',
  'sectionTitle',
  'disabled',
  'resetTrigger',
];

const SURFACE = {
  InteractiveStep: [...COMMON_PROPS, 'isCurrentlyExecuting', 'onStepReset'],
  InteractiveMultiStep: [...COMMON_PROPS, 'isCurrentlyExecuting', 'onStepReset'],
  InteractiveGuided: [...COMMON_PROPS, 'isCurrentlyExecuting', 'onStepReset'],
  InteractiveQuiz: [...COMMON_PROPS],
  TerminalStep: [...COMMON_PROPS],
  TerminalConnectStep: [...COMMON_PROPS],
  CodeBlockStep: [...COMMON_PROPS, 'isCurrentlyExecuting'],
};

function lastCapture(type: keyof typeof SURFACE): any {
  const bucket = captures.get(type);
  if (!bucket || bucket.length === 0) {
    throw new Error(`No capture recorded for ${type}`);
  }
  return bucket[bucket.length - 1];
}

function expectSurface(type: keyof typeof SURFACE) {
  const props = lastCapture(type);
  for (const key of SURFACE[type]) {
    expect({ type, key, present: key in props }).toEqual({ type, key, present: true });
  }
  // `stepId` should follow the section-stepN convention
  expect(typeof props.stepId).toBe('string');
  expect(props.stepId.length).toBeGreaterThan(0);
  // numeric coordinates
  expect(typeof props.stepIndex).toBe('number');
  expect(typeof props.totalSteps).toBe('number');
}

describe('InteractiveSection step-type symmetry — Phase 0 tripwire', () => {
  it('InteractiveStep receives the plain-step enhanced-prop surface', async () => {
    render(
      <InteractiveSection id="t1" title="t1" autoCollapse={false}>
        <InteractiveStep targetAction="highlight" refTarget=".a">
          x
        </InteractiveStep>
      </InteractiveSection>
    );
    await waitFor(() => expect(captures.get('InteractiveStep')).toBeDefined());
    expectSurface('InteractiveStep');
  });

  it('InteractiveMultiStep receives the multi-step enhanced-prop surface', async () => {
    render(
      <InteractiveSection id="t2" title="t2" autoCollapse={false}>
        <InteractiveMultiStep />
      </InteractiveSection>
    );
    await waitFor(() => expect(captures.get('InteractiveMultiStep')).toBeDefined());
    expectSurface('InteractiveMultiStep');
  });

  it('InteractiveGuided receives the guided enhanced-prop surface', async () => {
    render(
      <InteractiveSection id="t3" title="t3" autoCollapse={false}>
        <InteractiveGuided />
      </InteractiveSection>
    );
    await waitFor(() => expect(captures.get('InteractiveGuided')).toBeDefined());
    expectSurface('InteractiveGuided');
  });

  it('InteractiveQuiz receives the quiz enhanced-prop surface (no isCurrentlyExecuting, no onStepReset)', async () => {
    render(
      <InteractiveSection id="t4" title="t4" autoCollapse={false}>
        <InteractiveQuiz />
      </InteractiveSection>
    );
    await waitFor(() => expect(captures.get('InteractiveQuiz')).toBeDefined());
    expectSurface('InteractiveQuiz');

    // Negative assertions — quiz must NOT receive these props
    const props = lastCapture('InteractiveQuiz');
    expect('isCurrentlyExecuting' in props).toBe(false);
    expect('onStepReset' in props).toBe(false);
  });

  it('TerminalStep receives the terminal enhanced-prop surface', async () => {
    render(
      <InteractiveSection id="t5" title="t5" autoCollapse={false}>
        <TerminalStep />
      </InteractiveSection>
    );
    await waitFor(() => expect(captures.get('TerminalStep')).toBeDefined());
    expectSurface('TerminalStep');
    const props = lastCapture('TerminalStep');
    expect('isCurrentlyExecuting' in props).toBe(false);
    expect('onStepReset' in props).toBe(false);
  });

  it('TerminalConnectStep receives the terminal-connect enhanced-prop surface', async () => {
    render(
      <InteractiveSection id="t6" title="t6" autoCollapse={false}>
        <TerminalConnectStep />
      </InteractiveSection>
    );
    await waitFor(() => expect(captures.get('TerminalConnectStep')).toBeDefined());
    expectSurface('TerminalConnectStep');
    const props = lastCapture('TerminalConnectStep');
    expect('isCurrentlyExecuting' in props).toBe(false);
    expect('onStepReset' in props).toBe(false);
  });

  it('CodeBlockStep receives the code-block enhanced-prop surface (isCurrentlyExecuting but no onStepReset)', async () => {
    render(
      <InteractiveSection id="t7" title="t7" autoCollapse={false}>
        <CodeBlockStep />
      </InteractiveSection>
    );
    await waitFor(() => expect(captures.get('CodeBlockStep')).toBeDefined());
    expectSurface('CodeBlockStep');
    const props = lastCapture('CodeBlockStep');
    expect('onStepReset' in props).toBe(false);
  });

  it('stepId numbering increments per-type position within the section', async () => {
    render(
      <InteractiveSection id="numbering" title="numbering" autoCollapse={false}>
        <InteractiveStep targetAction="highlight" refTarget=".a">
          step 1
        </InteractiveStep>
        <InteractiveMultiStep />
        <TerminalStep />
      </InteractiveSection>
    );
    await waitFor(() => {
      expect(captures.get('InteractiveStep')).toBeDefined();
      expect(captures.get('InteractiveMultiStep')).toBeDefined();
      expect(captures.get('TerminalStep')).toBeDefined();
    });

    expect(lastCapture('InteractiveStep').stepId).toBe('section-numbering-step-1');
    expect(lastCapture('InteractiveMultiStep').stepId).toBe('section-numbering-multistep-2');
    expect(lastCapture('TerminalStep').stepId).toBe('section-numbering-terminal-3');
  });
});
