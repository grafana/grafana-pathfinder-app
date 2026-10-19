import React, { useRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { AssistantSelectionPopover } from './AssistantSelectionPopover';
import { useTextSelection } from './useTextSelection.hook';
import type { SelectionPosition } from '../../types/hooks.types';

const mockOpenAssistant = jest.fn();
jest.mock('@grafana/assistant', () => ({
  OpenAssistantButton: ({ prompt }: { prompt: string }) => (
    <button onClick={() => mockOpenAssistant(prompt)}>Ask Assistant</button>
  ),
}));
jest.mock('../../lib/analytics', () => ({
  reportAppInteraction: jest.fn(),
  UserInteraction: {},
  buildAssistantTextSelectionProperties: jest.fn(),
}));

function Guide() {
  const ref = useRef<HTMLDivElement>(null);
  const selection = useTextSelection(ref);
  return (
    <div ref={ref} data-testid="guide">
      <pre data-testid="code">Explain this query</pre>
      {selection.isValid && (
        <AssistantSelectionPopover selectedText={selection.selectedText} position={selection.position} context={[]} />
      )}
    </div>
  );
}

const rect = (top: number, left = 20) => ({ top, left, width: 100, height: 20 }) as DOMRect;

function selectQuery() {
  const code = screen.getByTestId('code');
  const range = document.createRange();
  range.selectNodeContents(code);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  const measure = jest.fn(() => rect(200));
  range.getBoundingClientRect = measure;
  fireEvent(document, new Event('selectionchange'));
  return measure;
}

beforeEach(() => {
  jest.useFakeTimers();
  mockOpenAssistant.mockClear();
});

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  jest.useRealTimers();
});

it('measures the settled selection and container together, and preserves selection when asking', () => {
  render(<Guide />);
  const measure = selectQuery();
  measure.mockReturnValue(rect(300));
  screen.getByTestId('guide').getBoundingClientRect = () => rect(100, 10);
  act(() => jest.advanceTimersByTime(400));
  const button = screen.getByRole('button', { name: 'Ask Assistant' });
  expect(button.parentElement).toHaveStyle({ top: '200px', left: '60px' });
  expect(fireEvent.mouseDown(button)).toBe(false);
  fireEvent.mouseUp(button);
  expect(button).toBeInTheDocument();
  fireEvent.click(button);
  expect(mockOpenAssistant).toHaveBeenCalledWith('explain based on my context this documentation: Explain this query');
});

it.each(['scroll', 'resize'])('dismisses the button on %s and cancels pending selections', (event) => {
  render(<Guide />);
  selectQuery();
  const target = event === 'scroll' ? screen.getByTestId('code') : window;
  fireEvent(target, new Event(event));
  act(() => jest.advanceTimersByTime(400));
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  selectQuery();
  act(() => jest.advanceTimersByTime(400));
  expect(screen.getByRole('button')).toBeInTheDocument();
  fireEvent(target, new Event(event));
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

it('updates position even when the selected text is unchanged', () => {
  const position: SelectionPosition = { top: 100, left: 50, width: 100, height: 20, buttonPlacement: 'top' };
  const { rerender } = render(<AssistantSelectionPopover selectedText="Same text" position={position} context={[]} />);
  rerender(<AssistantSelectionPopover selectedText="Same text" position={{ ...position, top: 300 }} context={[]} />);
  expect(screen.getByRole('button').parentElement).toHaveStyle({ top: '300px' });
});

it('rejects selections outside the guide', () => {
  render(
    <>
      <p data-testid="outside">Outside text</p>
      <Guide />
    </>
  );
  const range = document.createRange();
  range.selectNodeContents(screen.getByTestId('outside'));
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  fireEvent(document, new Event('selectionchange'));
  act(() => jest.advanceTimersByTime(400));
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

it('does not resurrect a selection after clicking outside the guide', () => {
  render(<Guide />);
  selectQuery();
  act(() => jest.advanceTimersByTime(400));
  fireEvent.mouseDown(document.body);
  fireEvent.mouseUp(document.body);
  act(() => jest.advanceTimersByTime(400));
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

it('reads the current selection after the delay instead of a captured range', () => {
  render(<Guide />);
  selectQuery();
  window.getSelection()!.removeAllRanges();
  act(() => jest.advanceTimersByTime(400));
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

it('cancels deferred selection measurements when the guide unmounts', () => {
  const { unmount } = render(<Guide />);
  const measure = selectQuery();
  unmount();
  act(() => jest.advanceTimersByTime(400));
  expect(measure).not.toHaveBeenCalled();
});
