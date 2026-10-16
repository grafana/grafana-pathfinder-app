import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { testIds } from '../../constants/testIds';
import { markStepCompleted, resetCompletionStoreForTests } from '../../global-state/completion-store';
import { clearAndInsertCode } from '../../interactive-engine';
import { useStepChecker } from '../../requirements-manager';
import { interactiveStepStorage } from '../../lib/user-storage';
import { logger } from '../../lib/logging';
import { CodeBlockStep } from './code-block-step';

jest.mock('../../interactive-engine', () => ({
  clearAndInsertCode: jest.fn(),
  useInteractiveElements: () => ({ executeInteractiveAction: jest.fn() }),
}));
jest.mock('../../requirements-manager', () => ({
  useStepChecker: jest.fn(),
  validateInteractiveRequirements: jest.fn(),
}));
jest.mock('../../global-state/panel-mode', () => ({
  panelModeManager: { getMode: () => 'sidebar' },
}));

const STEP_ID = 'insert-query';
const root = () => screen.getByTestId(testIds.codeBlock.step(STEP_ID));
const insert = () => screen.getByTestId(testIds.codeBlock.insertButton(STEP_ID));
const insertMock = jest.mocked(clearAndInsertCode);
const checkerMock = jest.mocked(useStepChecker);

beforeEach(async () => {
  jest.clearAllMocks();
  await interactiveStepStorage.clearAll();
  resetCompletionStoreForTests();
  checkerMock.mockReturnValue({ isEnabled: true, isChecking: false } as ReturnType<typeof useStepChecker>);
  insertMock.mockResolvedValue({ success: true });
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('exposes the root, Insert control, and explicit successful completion', async () => {
  render(<CodeBlockStep stepId={STEP_ID} code="up" refTarget="#editor" />);

  expect(root()).toHaveAttribute('data-test-step-kind', 'codeblock');
  expect(root()).toHaveAttribute('data-test-step-id', STEP_ID);
  expect(root()).toHaveAttribute('data-test-step-state', 'idle');
  expect(root()).toHaveAttribute('data-test-skippable', 'false');
  fireEvent.click(insert());

  await waitFor(() => expect(root()).toHaveAttribute('data-test-step-state', 'completed'));
  expect(insertMock).toHaveBeenCalledWith('#editor', 'up');
  expect(screen.queryByTestId(testIds.codeBlock.insertButton(STEP_ID))).not.toBeInTheDocument();
});

it('keeps Show me distinct from insertion and completion', async () => {
  render(<CodeBlockStep stepId={STEP_ID} code="up" refTarget="#editor" />);
  fireEvent.click(screen.getByTestId(testIds.codeBlock.showMeButton(STEP_ID)));

  await waitFor(() => expect(root()).toHaveAttribute('data-test-step-state', 'idle'));
  expect(insertMock).not.toHaveBeenCalled();
  expect(insert()).toBeEnabled();
});

it('exposes executing until the insertion result settles', async () => {
  let complete!: (value: { success: boolean }) => void;
  insertMock.mockReturnValue(
    new Promise((resolve) => {
      complete = resolve;
    })
  );
  render(<CodeBlockStep stepId={STEP_ID} code="up" refTarget="#editor" />);
  fireEvent.click(insert());

  await waitFor(() => expect(root()).toHaveAttribute('data-test-step-state', 'executing'));
  expect(insert()).toHaveAttribute('aria-disabled', 'true');
  await act(async () => {
    complete({ success: true });
  });
  expect(root()).toHaveAttribute('data-test-step-state', 'completed');
});

it.each(['result', 'exception'])('exposes insertion errors and allows retry: %s', async (failure) => {
  if (failure === 'result') {
    insertMock.mockResolvedValueOnce({ success: false, error: 'Editor not found' });
  } else {
    jest.spyOn(logger, 'error').mockImplementation(() => undefined);
    insertMock.mockRejectedValueOnce(new Error('Editor not found'));
  }
  render(<CodeBlockStep stepId={STEP_ID} code="up" refTarget="#editor" />);
  fireEvent.click(insert());

  await waitFor(() => expect(root()).toHaveAttribute('data-test-step-state', 'error'));
  expect(screen.getByTestId(testIds.interactive.errorMessage(STEP_ID))).toHaveTextContent('Editor not found');
  expect(insert()).toBeEnabled();

  fireEvent.click(insert());
  await waitFor(() => expect(root()).toHaveAttribute('data-test-step-state', 'completed'));
  expect(screen.queryByTestId(testIds.interactive.errorMessage(STEP_ID))).not.toBeInTheDocument();
});

it('exposes checking without claiming completed or unmet requirements', () => {
  checkerMock.mockReturnValue({ isEnabled: false, isChecking: true } as ReturnType<typeof useStepChecker>);
  render(<CodeBlockStep stepId={STEP_ID} code="up" refTarget="#editor" />);

  expect(root()).toHaveAttribute('data-test-step-state', 'checking');
  expect(screen.queryByTestId(testIds.codeBlock.insertButton(STEP_ID))).not.toBeInTheDocument();
});

it('exposes unmet requirements and synchronizes an explicit Skip', async () => {
  checkerMock.mockReturnValue({
    isEnabled: false,
    isChecking: false,
    explanation: 'Open Explore first',
  } as ReturnType<typeof useStepChecker>);
  render(<CodeBlockStep stepId={STEP_ID} code="up" refTarget="#editor" skippable />);

  expect(root()).toHaveAttribute('data-test-step-state', 'requirements-unmet');
  expect(root()).toHaveAttribute('data-test-skippable', 'true');
  expect(getComputedStyle(root()).pointerEvents).not.toBe('none');
  expect(screen.getByTestId(testIds.interactive.requirementCheck(STEP_ID))).toHaveTextContent('Open Explore first');
  fireEvent.click(screen.getByTestId(testIds.interactive.skipButton(STEP_ID)));

  await waitFor(() => expect(root()).toHaveAttribute('data-test-step-state', 'completed'));
  expect(insertMock).not.toHaveBeenCalled();
});

it('exposes skippability even before the Skip control appears', () => {
  render(<CodeBlockStep stepId={STEP_ID} code="up" refTarget="#editor" skippable />);

  expect(root()).toHaveAttribute('data-test-skippable', 'true');
  expect(screen.queryByTestId(testIds.interactive.skipButton(STEP_ID))).not.toBeInTheDocument();
});

it('notifies the section only after successful insertion', async () => {
  const onStepComplete = jest.fn((id: string) => markStepCompleted(id, 'section-query', 'manual'));
  insertMock.mockResolvedValueOnce({ success: false, error: 'Editor not found' });
  render(
    <CodeBlockStep
      stepId={STEP_ID}
      sectionId="section-query"
      code="up"
      refTarget="#editor"
      onStepComplete={onStepComplete}
    />
  );
  fireEvent.click(insert());
  await waitFor(() => expect(root()).toHaveAttribute('data-test-step-state', 'error'));
  expect(onStepComplete).not.toHaveBeenCalled();

  fireEvent.click(insert());
  await waitFor(() => expect(root()).toHaveAttribute('data-test-step-state', 'completed'));
  expect(onStepComplete).toHaveBeenCalledTimes(1);
  expect(onStepComplete).toHaveBeenCalledWith(STEP_ID);
});
