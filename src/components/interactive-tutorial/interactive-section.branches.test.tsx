import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { InteractiveConditional } from './interactive-conditional';
import { InteractiveSection, resetInteractiveCounters } from './interactive-section';
import { InteractiveStep } from './interactive-step';
import { resetSectionHarness, setCheckRequirementsResult } from '../../test-utils/interactive-section-harness';
import { interactiveStepStorage } from '../../lib/user-storage';
import { testIds } from '../../constants/testIds';

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
  return require('../../test-utils/interactive-section-harness').createInteractiveEngineMock();
});

jest.mock('../../requirements-manager', () => {
  return require('../../test-utils/interactive-section-harness').createRequirementsManagerMock();
});

jest.mock('../../docs-retrieval', () => {
  return require('../../test-utils/interactive-section-harness').createDocsRetrievalMock();
});

jest.mock('./interactive-step', () => {
  const React = require('react');
  return {
    InteractiveStep: ({ stepId, sectionId, isEligibleForChecking, onStepComplete }: any) =>
      React.createElement(
        'button',
        {
          'data-testid': stepId,
          'data-section': sectionId,
          disabled: !isEligibleForChecking,
          onClick: () => onStepComplete?.(stepId),
        },
        stepId
      ),
    resetStepCounter: jest.fn(),
  };
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

beforeEach(() => {
  resetSectionHarness();
  resetInteractiveCounters();
});

it('keeps a completed branch selected until section reset', async () => {
  render(
    <InteractiveSection id="branch-owner" title="Branch owner" autoCollapse={false}>
      <InteractiveStep stepId="before" targetAction="button" refTarget="#before" />
      <InteractiveConditional
        id="branch"
        keyPrefix="branch"
        conditions={['has-datasources']}
        whenTrueChildren={[{ type: 'interactive-step', props: { stepId: 'true-child' }, children: [] }]}
        whenFalseChildren={[{ type: 'interactive-step', props: { stepId: 'false-child' }, children: [] }]}
        renderElement={(element, key) => (
          <InteractiveStep key={key} stepId={element.props.stepId} targetAction="button" refTarget="#child" />
        )}
      />
      <InteractiveStep stepId="after" targetAction="button" refTarget="#after" />
    </InteractiveSection>
  );
  await screen.findByTestId('true-child');
  await waitFor(() => expect(screen.getByTestId('true-child')).toHaveAttribute('data-section', 'section-branch-owner'));
  expect(screen.getByTestId('true-child')).toBeDisabled();
  fireEvent.click(screen.getByTestId('before'));
  await waitFor(() => expect(screen.getByTestId('true-child')).toBeEnabled());
  expect(screen.getByTestId('after')).toBeDisabled();
  fireEvent.click(screen.getByTestId('true-child'));
  await waitFor(() => expect(screen.getByTestId('after')).toBeEnabled());
  setCheckRequirementsResult({ pass: false, error: [] });
  act(() => {
    window.dispatchEvent(new Event('guide-response-changed'));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 350));
  });
  expect(screen.queryByTestId('false-child')).not.toBeInTheDocument();
  expect(screen.getByTestId('true-child')).toBeInTheDocument();
  expect((await interactiveStepStorage.getCompleted('/', 'section-branch-owner')).has('true-child')).toBe(true);
  fireEvent.click(screen.getByTestId('after'));
  const reset = await screen.findByTestId(testIds.interactive.resetSectionButton('section-branch-owner'));
  fireEvent.click(reset);
  await screen.findByTestId('false-child');
  expect(screen.getByTestId('false-child')).toBeDisabled();
  await waitFor(async () =>
    expect((await interactiveStepStorage.getCompleted('/', 'section-branch-owner')).size).toBe(0)
  );
});

it('keeps the active step mounted when its rendered props are refreshed', async () => {
  const content = () => (
    <InteractiveSection id="stable-owner" title="Stable owner">
      <InteractiveConditional
        id="stable-branch"
        keyPrefix="stable-branch"
        conditions={['has-datasources']}
        whenTrueChildren={[{ type: 'interactive-step', props: { stepId: 'stable-child' }, children: [] }]}
        whenFalseChildren={[]}
        renderElement={(element, key) => (
          <InteractiveStep key={key} stepId={element.props.stepId} targetAction="button" refTarget="#child" />
        )}
      />
    </InteractiveSection>
  );
  const view = render(content());
  const original = await screen.findByTestId('stable-child');
  view.rerender(content());
  expect(screen.getByTestId('stable-child')).toBe(original);
});

it('restores the completed branch after remounting on a different page', async () => {
  const content = () => (
    <InteractiveSection id="restore-owner" title="Restore owner">
      <InteractiveConditional
        id="restore-branch"
        keyPrefix="restore-branch"
        conditions={['has-datasources']}
        whenTrueChildren={[{ type: 'interactive-step', props: { stepId: 'saved-child' }, children: [] }]}
        whenFalseChildren={[{ type: 'interactive-step', props: { stepId: 'alternate-child' }, children: [] }]}
        renderElement={(element, key) => (
          <InteractiveStep key={key} stepId={element.props.stepId} targetAction="button" refTarget="#child" />
        )}
      />
    </InteractiveSection>
  );
  const view = render(content());
  await screen.findByTestId('saved-child');
  fireEvent.click(screen.getByTestId('saved-child'));
  await waitFor(async () =>
    expect((await interactiveStepStorage.getCompleted('/', 'section-restore-owner')).has('saved-child')).toBe(true)
  );
  view.unmount();
  setCheckRequirementsResult({ pass: false, error: [] });
  render(content());
  await screen.findByTestId('saved-child');
  expect(screen.queryByTestId('alternate-child')).not.toBeInTheDocument();
});
