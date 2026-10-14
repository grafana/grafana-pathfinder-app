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

jest.mock('./hooks/use-section-checkpoint', () => ({
  useSectionCheckpoint: () => {
    const [passed, setPassed] = require('react').useState(false);
    return {
      passed,
      status: { passed, canRestore: true, explanation: 'Open the query options.' },
      restoring: false,
      restore: () => setPassed(true),
      recheck: jest.fn(),
    };
  },
}));

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

it('holds step checks until recovery succeeds with a single restore action', async () => {
  render(
    <InteractiveSection
      id="recovery"
      title="Inspect query options"
      autoCollapse={false}
      checkpoint={{ checks: [{ requirement: 'on-page:/explore' }] }}
    >
      <InteractiveStep targetAction="highlight" refTarget=".options">
        Inspect options.
      </InteractiveStep>
    </InteractiveSection>
  );
  await waitFor(() => expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Continue step' })).toBeDisabled();
  expect(document.querySelector('details')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Check again' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Continue step' })).toBeEnabled());
  expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument();
});

it('stops offering recovery once the section is complete', async () => {
  setStepCheckerCompletionReason('objectives');
  const { container } = render(
    <InteractiveSection
      id="recovery"
      title="Inspect query options"
      autoCollapse={false}
      objectives={['on-page:/explore']}
      checkpoint={{ checks: [{ requirement: 'on-page:/explore' }] }}
    >
      <InteractiveStep targetAction="highlight" refTarget=".options">
        Inspect options.
      </InteractiveStep>
    </InteractiveSection>
  );
  await waitFor(() => expect(container.querySelector('.interactive-section.completed')).toBeInTheDocument());
  expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument();
  expect(container.querySelector('.checkpoint-paused')).not.toBeInTheDocument();
});
