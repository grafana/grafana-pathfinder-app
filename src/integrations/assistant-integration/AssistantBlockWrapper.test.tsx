import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AssistantBlockWrapper } from './AssistantBlockWrapper';
import { useAssistantBlockValue } from './AssistantBlockValueContext';
import { useAssistantGeneration } from './useAssistantGeneration.hook';
import { InteractiveStep } from '../../components/interactive-tutorial/interactive-step';
import { resetCompletionStoreForTests } from '../../global-state/completion-store';

jest.mock('./useAssistantGeneration.hook', () => ({
  ...jest.requireActual('./useAssistantGeneration.hook'),
  useAssistantGeneration: jest.fn(),
}));

const mockExecuteInteractiveAction = jest.fn();
jest.mock('../../interactive-engine', () => ({
  ...jest.requireActual('../../interactive-engine'),
  useInteractiveElements: () => ({
    executeInteractiveAction: mockExecuteInteractiveAction,
    verifyStepResult: jest.fn().mockResolvedValue({ passed: true }),
  }),
}));

const mockGenerate = jest.fn();
const mockReset = jest.fn();
const mockCreateMetadataTool = jest.fn(() => ({}));

function Query() {
  const context = useAssistantBlockValue();
  return <output>{context?.customizedValue ?? '@@CLEAR@@ up'}</output>;
}

function renderQuery() {
  return render(
    <AssistantBlockWrapper
      assistantId="visible-query"
      assistantType="query"
      defaultValue="@@CLEAR@@ up"
      blockType="interactive"
      contentKey="bundled:test"
    >
      <Query />
    </AssistantBlockWrapper>
  );
}

beforeEach(() => {
  localStorage.clear();
  resetCompletionStoreForTests();
  mockExecuteInteractiveAction.mockResolvedValue(true);
  jest.clearAllMocks();
  jest.mocked(useAssistantGeneration).mockReturnValue({
    isAssistantAvailable: true,
    isGenerating: false,
    content: '',
    generate: mockGenerate,
    reset: mockReset,
    getDatasourceContext: jest.fn().mockResolvedValue({ currentDatasource: { type: 'prometheus' } }),
    isSupportedDatasource: jest.fn().mockReturnValue(true),
    createMetadataTool: mockCreateMetadataTool,
    getStorageKey: () => 'test-customized-query',
  } as unknown as ReturnType<typeof useAssistantGeneration>);
});

it('exposes customization without hovering and restores the original query on revert', async () => {
  mockGenerate.mockImplementation(async ({ onComplete }) => onComplete('QUERY: sum(up)'));
  renderQuery();

  const customize = screen.getByRole('button', { name: 'Customize with Assistant' });
  expect(customize).toBeVisible();
  customize.focus();
  expect(customize).toHaveFocus();
  fireEvent.click(customize);

  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('@@CLEAR@@ sum(up)'));
  const revert = screen.getByRole('button', { name: 'Revert to original' });
  expect(revert).toBeVisible();
  fireEvent.click(revert);

  expect(screen.getByRole('status')).toHaveTextContent('@@CLEAR@@ up');
  expect(screen.getByRole('button', { name: 'Customize with Assistant' })).toBeVisible();
  expect(mockReset).toHaveBeenCalledTimes(1);
});

it('keeps retry and dismiss available after generation fails', async () => {
  mockGenerate.mockImplementation(async ({ onError }) => onError(new Error('Try again')));
  renderQuery();
  fireEvent.click(screen.getByRole('button', { name: 'Customize with Assistant' }));
  expect(await screen.findByRole('button', { name: 'Retry' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss error' }));
  expect(screen.getByRole('button', { name: 'Customize with Assistant' })).toBeVisible();
});

it('does not offer generation when Assistant is unavailable', () => {
  jest.mocked(useAssistantGeneration).mockReturnValue({
    ...jest.mocked(useAssistantGeneration)({ contentKey: 'bundled:test', assistantId: 'visible-query' }),
    isAssistantAvailable: false,
  });
  renderQuery();
  expect(screen.queryByRole('button', { name: 'Customize with Assistant' })).not.toBeInTheDocument();
});

it('passes the customized expression and reverted original to Do it', async () => {
  mockGenerate.mockImplementation(async ({ onComplete }) => onComplete('QUERY: sum(up)'));
  render(
    <>
      <textarea id="query-target" />
      <AssistantBlockWrapper
        assistantId="insert-query"
        assistantType="query"
        defaultValue="@@CLEAR@@ up"
        blockType="interactive"
        contentKey="bundled:test"
      >
        <InteractiveStep
          stepId="insert-query"
          targetAction="formfill"
          refTarget="#query-target"
          targetValue="@@CLEAR@@ up"
          doIt
        >
          Original query
        </InteractiveStep>
      </AssistantBlockWrapper>
    </>
  );
  fireEvent.click(screen.getByRole('button', { name: 'Customize with Assistant' }));
  await screen.findByRole('button', { name: 'Revert to original' });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Do it' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Do it' }));
  await waitFor(() =>
    expect(mockExecuteInteractiveAction).toHaveBeenCalledWith(
      expect.objectContaining({ targetValue: '@@CLEAR@@ sum(up)' })
    )
  );
  fireEvent.click(screen.getByRole('button', { name: 'Revert to original' }));
  fireEvent.click(await screen.findByRole('button', { name: /Redo/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Do it' }));
  await waitFor(() =>
    expect(mockExecuteInteractiveAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ targetValue: '@@CLEAR@@ up' })
    )
  );
});
