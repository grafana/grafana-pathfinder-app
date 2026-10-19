import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

// ─── Mocks (shared harness) ─────────────────────────────────────────────────

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

jest.mock('../../lib/logging', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), exception: jest.fn() },
}));
jest.mock('../../lib/faro', () => ({
  withFaroUserAction: jest.fn((_name: string, _attributes: unknown, work: () => unknown) => work()),
  setFaroUserActionAttributes: jest.fn(),
  USER_ACTION_TIMEOUT_LONG_MS: 600000,
}));

jest.mock('../../constants/interactive-config', () => {
  return require('../../test-utils/interactive-section-harness').createInteractiveConfigMock();
});

jest.mock('../../lib/user-storage', () => {
  return require('../../test-utils/interactive-section-harness').createUserStorageMock();
});

const mockAlignmentPaused = jest.fn(() => false);
jest.mock('../../global-state/alignment-pending-context', () => ({
  ...require('../../test-utils/interactive-section-harness').createAlignmentContextMock(),
  useIsAlignmentPaused: () => mockAlignmentPaused(),
}));

jest.mock('../../interactive-engine', () => {
  return require('../../test-utils/interactive-section-harness').createInteractiveEngineMock();
});

jest.mock('../../requirements-manager', () => {
  return require('../../test-utils/interactive-section-harness').createRequirementsManagerMock();
});

jest.mock('../../docs-retrieval', () => {
  return require('../../test-utils/interactive-section-harness').createDocsRetrievalMock();
});

function mockRunnableStep(label: string) {
  return function MockRunnableStep(props: {
    stepId?: string;
    isEligibleForChecking: boolean;
    onExecutingChange?: (executing: boolean) => void;
    onStepComplete?: (stepId: string) => void;
    recoveryHint?: unknown;
  }) {
    const { createElement, Fragment } = require('react');
    return createElement(
      Fragment,
      null,
      createElement(
        'button',
        { disabled: !props.isEligibleForChecking, onClick: () => props.stepId && props.onStepComplete?.(props.stepId) },
        'Continue step'
      ),
      props.recoveryHint ? createElement('output', null, JSON.stringify(props.recoveryHint)) : null,
      createElement('button', { onClick: () => props.onExecutingChange?.(true) }, `Start ${label}`),
      createElement('button', { onClick: () => props.onExecutingChange?.(false) }, `Finish ${label}`)
    );
  };
}

jest.mock('./interactive-step', () => ({
  resetStepCounter: jest.fn(),
  InteractiveStep: mockRunnableStep('step'),
}));

const mockRecovery = {
  plans: new Map<string, unknown>(),
  suspended: new Map<string, boolean | undefined>(),
  paused: false,
  unrestorable: false,
  restore: jest.fn(),
  recheck: jest.fn(async () => true),
};
jest.mock('./hooks/use-section-recovery', () => ({
  useSectionRecovery: (
    plan: unknown,
    sectionId: string,
    _enabled: boolean,
    _controllerMode: boolean,
    options: { suspended?: boolean } = {}
  ) => {
    mockRecovery.plans.set(sectionId, plan);
    mockRecovery.suspended.set(sectionId, options.suspended);
    return {
      paused: mockRecovery.paused,
      unrestorable: mockRecovery.unrestorable,
      restoring: false,
      restore: mockRecovery.restore,
      cancel: jest.fn(),
      recheck: mockRecovery.recheck,
    };
  },
}));

const mockRecoveryEnabled = jest.fn(() => true);
jest.mock('../../utils/section-recovery-enablement', () => ({ isSectionRecoveryEnabled: () => mockRecoveryEnabled() }));

jest.mock('./interactive-multi-step', () => ({
  resetMultiStepCounter: jest.fn(),
  InteractiveMultiStep: mockRunnableStep('multistep'),
}));

jest.mock('./interactive-guided', () => ({
  resetGuidedCounter: jest.fn(),
  InteractiveGuided: mockRunnableStep('guided'),
}));

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
import { InteractiveMultiStep } from './interactive-multi-step';
import { InteractiveGuided } from './interactive-guided';
import { testIds } from '../../constants/testIds';
import { InteractiveSection, resetInteractiveCounters } from './interactive-section';
import {
  executeInteractiveActionCalls,
  resetSectionHarness,
  setCheckRequirementsResult,
  setStepCheckerCompletionReason,
  silenceSectionWarnings,
} from '../../test-utils/interactive-section-harness';

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
});

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  mockRecovery.plans.clear();
  mockRecovery.suspended.clear();
  mockAlignmentPaused.mockReturnValue(false);
  mockRecovery.paused = false;
  mockRecovery.unrestorable = false;
  mockRecovery.recheck.mockResolvedValue(true);
  mockRecoveryEnabled.mockReturnValue(true);
});

function exploreSection(id = 'explore', extra: Record<string, unknown> = {}) {
  return (
    <InteractiveSection id={id} title="Explore" autoCollapse={false} {...extra}>
      <InteractiveStep targetAction="highlight" refTarget="#row" targetState="aria-expanded:true">
        Open the row.
      </InteractiveStep>
      <InteractiveStep targetAction="button" refTarget="Run query" requirements={['on-page:/explore']}>
        Run it.
      </InteractiveStep>
    </InteractiveSection>
  );
}

it('derives recovery from the section steps with no authoring', async () => {
  render(exploreSection());
  await waitFor(() => expect(mockRecovery.plans.get('section-explore')).toBeDefined());
  expect(mockRecovery.plans.get('section-explore')).toMatchObject({
    checks: [
      {
        kind: 'target-present',
        refTarget: '#row',
        targetAction: 'highlight',
        recover: [{ kind: 'resume-location' }],
      },
    ],
  });
});

it('shows Restore and holds the steps only while recovery is paused', async () => {
  mockRecovery.paused = true;
  const { container } = render(exploreSection());
  const restore = await screen.findByRole('button', { name: 'Restore' });
  expect(container.querySelector('.recovery-paused')).toBeInTheDocument();
  screen.getAllByRole('button', { name: 'Continue step' }).forEach((step) => expect(step).toBeDisabled());
  fireEvent.click(restore);
  expect(mockRecovery.restore).toHaveBeenCalled();
});

it('shows nothing and gates nothing when recovery is not paused', async () => {
  const { container } = render(exploreSection());
  await waitFor(() => expect(container.querySelector('.interactive-section')).toBeInTheDocument());
  expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument();
  expect(container.querySelector('.recovery-paused')).not.toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Continue step' })[0]).toBeEnabled();
});

it('has no recovery plan once the section is complete', async () => {
  setStepCheckerCompletionReason('objectives');
  const { container } = render(exploreSection('explore', { objectives: ['on-page:/explore'] }));
  await waitFor(() => expect(container.querySelector('.interactive-section.completed')).toBeInTheDocument());
  expect(mockRecovery.plans.get('section-explore')).toBeUndefined();
});

it('has no recovery plan when the kill switch is off', async () => {
  mockRecoveryEnabled.mockReturnValue(false);
  render(exploreSection());
  await waitFor(() => expect(mockRecovery.plans.has('section-explore')).toBe(true));
  expect(mockRecovery.plans.get('section-explore')).toBeUndefined();
});

it.each(['hide', 'heading-only'] as const)(
  'does not wait on an earlier branch the learner did not choose (%s)',
  async (whenRequirementsUnmet) => {
    setCheckRequirementsResult({ pass: false, error: [] });
    render(
      <>
        <InteractiveSection
          id="unchosen"
          title="Unchosen branch"
          requirements={['var-signals:includes:logs']}
          whenRequirementsUnmet={whenRequirementsUnmet}
          autoCollapse={false}
        >
          <InteractiveStep targetAction="highlight" refTarget=".logs">
            Logs step.
          </InteractiveStep>
        </InteractiveSection>
        {exploreSection('after-branch')}
      </>
    );
    await waitFor(() => expect(mockRecovery.plans.get('section-after-branch')).toBeDefined());
  }
);

it('keeps a later section quiet until the learner reaches it', async () => {
  render(
    <>
      <InteractiveSection id="first" title="First" autoCollapse={false}>
        <InteractiveStep targetAction="highlight" refTarget=".first">
          First step.
        </InteractiveStep>
      </InteractiveSection>
      {exploreSection('later')}
    </>
  );
  await waitFor(() => expect(mockRecovery.plans.has('section-later')).toBe(true));
  expect(mockRecovery.plans.get('section-first')).toBeDefined();
  expect(mockRecovery.plans.get('section-later')).toBeUndefined();
});

function setupSection(intro: React.ReactNode = <p>Open the editor.</p>) {
  return (
    <InteractiveSection id="setup" title="Set up" autoCollapse={false}>
      {intro}
      <InteractiveStep targetAction="button" refTarget="Save">
        Save the dashboard.
      </InteractiveStep>
      <InteractiveStep targetAction="highlight" refTarget="#panel">
        Look at the panel.
      </InteractiveStep>
    </InteractiveSection>
  );
}

async function completeFirstStep() {
  fireEvent.click(screen.getAllByRole('button', { name: 'Continue step' })[0]!);
  await waitFor(() =>
    expect(mockRecovery.plans.get('section-setup')).toMatchObject({ cursorStepId: 'section-setup-step-2' })
  );
}

it('points the step after a one-way barrier at the numbered step that set it up', async () => {
  mockRecovery.unrestorable = true;
  const { container } = render(setupSection());
  await completeFirstStep();
  const hints = container.querySelectorAll('output');
  expect(hints).toHaveLength(1);
  expect(JSON.parse(hints[0]!.textContent!)).toEqual({ stepId: 'section-setup-step-1', stepNumber: 2 });
});

it('leaves the setup step unnumbered when an earlier conditional may hide its number', async () => {
  mockRecovery.unrestorable = true;
  const Conditional = Object.assign(() => null, { displayName: 'InteractiveConditional' });
  const { container } = render(setupSection(<Conditional />));
  await completeFirstStep();
  expect(JSON.parse(container.querySelector('output')!.textContent!)).toEqual({ stepId: 'section-setup-step-1' });
});

it('offers no setup pointer unless recovery has found the drift it cannot restore', async () => {
  const { container } = render(setupSection());
  await completeFirstStep();
  expect(container.querySelector('output')).not.toBeInTheDocument();
});

it.each(['step', 'multistep', 'guided'])('suspends recovery while a %s runs', async (label) => {
  render(
    <InteractiveSection id="running" title="Running" autoCollapse={false}>
      <InteractiveStep targetAction="button" refTarget="Run query">
        Run it.
      </InteractiveStep>
      <InteractiveMultiStep internalActions={[{ targetAction: 'button', refTarget: 'Save' }]}>
        Save it.
      </InteractiveMultiStep>
      <InteractiveGuided internalActions={[{ targetAction: 'button', refTarget: 'Apply' }]}>
        Apply it.
      </InteractiveGuided>
    </InteractiveSection>
  );
  await waitFor(() => expect(mockRecovery.suspended.get('section-running')).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: `Start ${label}` }));
  await waitFor(() => expect(mockRecovery.suspended.get('section-running')).toBe(true));
  fireEvent.click(screen.getByRole('button', { name: `Finish ${label}` }));
  await waitFor(() => expect(mockRecovery.suspended.get('section-running')).toBe(false));
});

it('suspends recovery while Do Section runs', async () => {
  let finish!: (ready: boolean) => void;
  mockRecovery.recheck.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
  render(exploreSection());
  const doSection = await screen.findByTestId(testIds.interactive.doSectionButton('section-explore'));
  fireEvent.click(doSection);
  await waitFor(() => expect(mockRecovery.suspended.get('section-explore')).toBe(true));
  finish(false);
  await waitFor(() => expect(mockRecovery.suspended.get('section-explore')).toBe(false));
});

it('does not run Do Section when the recovery check fails', async () => {
  mockRecovery.recheck.mockResolvedValue(false);
  render(exploreSection());
  fireEvent.click(await screen.findByTestId(testIds.interactive.doSectionButton('section-explore')));
  await waitFor(() => expect(mockRecovery.recheck).toHaveBeenCalled());
  await waitFor(() => expect(mockRecovery.suspended.get('section-explore')).toBe(false));
  expect(executeInteractiveActionCalls).toHaveLength(0);
});

it('has no recovery plan while the guide waits for the learner to reach its starting page', async () => {
  mockAlignmentPaused.mockReturnValue(true);
  render(exploreSection());
  await waitFor(() => expect(mockRecovery.plans.has('section-explore')).toBe(true));
  expect(mockRecovery.plans.get('section-explore')).toBeUndefined();
});
