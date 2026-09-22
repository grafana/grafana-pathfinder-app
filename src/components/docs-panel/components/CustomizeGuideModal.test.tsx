import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { InlineAssistantOptions } from '@grafana/assistant';
import { CustomizeGuideModal } from './CustomizeGuideModal';
import { useAssistantGeneration } from '../../../integrations/assistant-integration';

jest.mock('../../../integrations/assistant-integration', () => ({ useAssistantGeneration: jest.fn() }));

const guide = {
  id: 'private-copy',
  title: 'Original (copy)',
  blocks: [{ type: 'markdown' as const, content: 'Original content' }],
};
const generate = jest.fn();
const cancel = jest.fn();
let options: InlineAssistantOptions;

beforeEach(() => {
  jest.clearAllMocks();
  generate.mockImplementation(async (value) => {
    options = value;
  });
  jest
    .mocked(useAssistantGeneration)
    .mockReturnValue({ generate, cancel, isAssistantAvailable: true } as unknown as ReturnType<
      typeof useAssistantGeneration
    >);
});

const renderModal = () => {
  const onReview = jest.fn();
  const onDismiss = jest.fn();
  const view = render(
    <CustomizeGuideModal
      guide={guide}
      sourceUrl="https://grafana.com/example/content.json"
      onReview={onReview}
      onDismiss={onDismiss}
    />
  );
  return { ...view, onReview, onDismiss };
};
const submit = async () => {
  fireEvent.change(screen.getByLabelText(/What should they learn/), { target: { value: 'Use our team conventions' } });
  fireEvent.click(screen.getByRole('button', { name: 'Customize and open editor' }));
  await waitFor(() => expect(generate).toHaveBeenCalled());
};

it('sends the full guide only on submission and hands validated output to the editor', async () => {
  const { onReview } = renderModal();
  expect(generate).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Customize and open editor' })).toBeDisabled();
  await submit();
  expect(JSON.parse(options.prompt).guide).toEqual(guide);
  expect(screen.getByRole('button', { name: 'Customizing…' })).toBeDisabled();
  const revised = { ...guide, title: 'Our customized guide' };
  act(() => options.onComplete?.(JSON.stringify(revised)));
  expect(onReview).toHaveBeenCalledWith(revised);
});

it('retains the answers and existing draft when validation fails, and allows retry', async () => {
  const { onReview } = renderModal();
  await submit();
  act(() => options.onComplete?.('invalid guide'));
  expect(onReview).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent('Assistant did not return a valid guide');
  expect(screen.getByLabelText(/What should they learn/)).toHaveValue('Use our team conventions');
  fireEvent.click(screen.getByRole('button', { name: 'Customize and open editor' }));
  await waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
  act(() => options.onComplete?.(JSON.stringify(guide)));
  expect(onReview).toHaveBeenCalledWith(guide);
});

it('cancels generation and ignores results after dismissal', async () => {
  const { onReview, onDismiss } = renderModal();
  await submit();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(cancel).toHaveBeenCalled();
  expect(onDismiss).toHaveBeenCalled();
  act(() => options.onComplete?.(JSON.stringify(guide)));
  expect(onReview).not.toHaveBeenCalled();
});

it('ignores results after unmount', async () => {
  const { unmount, onReview } = renderModal();
  await submit();
  unmount();
  act(() => options.onComplete?.(JSON.stringify(guide)));
  expect(cancel).toHaveBeenCalled();
  expect(onReview).not.toHaveBeenCalled();
});

it('handles Assistant errors without importing a draft', async () => {
  const { onReview } = renderModal();
  await submit();
  act(() => options.onError?.(new Error('Service unavailable')));
  expect(screen.getByRole('alert')).toHaveTextContent('Assistant could not customize this guide');
  expect(onReview).not.toHaveBeenCalled();
});

it('ignores a previous attempt completing after a retry starts', async () => {
  const { onReview } = renderModal();
  await submit();
  const first = options;
  act(() => first.onError?.(new Error('Disconnected')));
  fireEvent.click(screen.getByRole('button', { name: 'Customize and open editor' }));
  await waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
  act(() => first.onComplete?.(JSON.stringify({ ...guide, title: 'Stale' })));
  expect(onReview).not.toHaveBeenCalled();
  act(() => options.onComplete?.(JSON.stringify({ ...guide, title: 'Current' })));
  expect(onReview).toHaveBeenCalledWith(expect.objectContaining({ title: 'Current' }));
});

it('does not generate when Assistant becomes unavailable', async () => {
  jest
    .mocked(useAssistantGeneration)
    .mockReturnValue({ generate, cancel, isAssistantAvailable: false } as unknown as ReturnType<
      typeof useAssistantGeneration
    >);
  renderModal();
  fireEvent.change(screen.getByLabelText(/What should they learn/), { target: { value: 'Customize' } });
  expect(screen.getByRole('button', { name: 'Customize and open editor' })).toBeDisabled();
  expect(screen.getByText('Assistant is unavailable. Try again later.')).toBeInTheDocument();
  expect(generate).not.toHaveBeenCalled();
});
