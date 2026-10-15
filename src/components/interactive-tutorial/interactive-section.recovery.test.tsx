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

jest.mock('./interactive-step', () => ({
  resetStepCounter: jest.fn(),
  InteractiveStep: (props: { isEligibleForChecking: boolean }) =>
    require('react').createElement('button', { disabled: !props.isEligibleForChecking }, 'Continue step'),
}));

const mockRecovery = {
  plans: new Map<string, unknown>(),
  paused: false,
  restore: jest.fn(),
  recheck: jest.fn(async () => true),
};
jest.mock('./hooks/use-section-recovery', () => ({
  useSectionRecovery: (plan: unknown, sectionId: string) => {
    mockRecovery.plans.set(sectionId, plan);
    return {
      paused: mockRecovery.paused,
      restoring: false,
      restore: mockRecovery.restore,
      cancel: jest.fn(),
      recheck: mockRecovery.recheck,
    };
  },
}));

const mockRecoveryEnabled = jest.fn(() => true);
jest.mock('../../utils/section-recovery-enablement', () => ({ isSectionRecoveryEnabled: () => mockRecoveryEnabled() }));

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
  resetSectionHarness,
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
  mockRecovery.paused = false;
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
