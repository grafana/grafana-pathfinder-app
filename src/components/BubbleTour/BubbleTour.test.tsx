import React from 'react';
import { render, fireEvent, act, waitFor } from '@testing-library/react';

import { BubbleTour, type BubbleTourStep } from './BubbleTour';

const mockHighlightWithComment = jest.fn().mockResolvedValue(undefined);
const mockShowCenteredComment = jest.fn();
const mockClearAllHighlights = jest.fn();

jest.mock('../../interactive-engine', () => ({
  NavigationManager: jest.fn().mockImplementation(() => ({
    highlightWithComment: mockHighlightWithComment,
    showCenteredComment: mockShowCenteredComment,
    clearAllHighlights: mockClearAllHighlights,
  })),
}));

const mockResolveWithRetry = jest.fn();
jest.mock('../../lib/dom', () => ({
  resolveWithRetry: (...args: unknown[]) => mockResolveWithRetry(...args),
}));

const STEPS: BubbleTourStep[] = [
  { target: '#one', title: 'One', content: 'First' },
  { target: '#two', title: 'Two', content: 'Second' },
  { target: '#three', title: 'Three', content: 'Third' },
];

/** Positional contract of `highlightWithComment`. */
const ARG = {
  element: 0,
  comment: 1,
  stepInfo: 3,
  onCancel: 5,
  onNext: 6,
  onPrevious: 7,
  options: 8,
} as const;

function lastHighlight() {
  return mockHighlightWithComment.mock.calls.at(-1)!;
}

async function renderTour(props: Partial<React.ComponentProps<typeof BubbleTour>> = {}) {
  const onClose = props.onClose ?? jest.fn();
  const result = render(<BubbleTour steps={props.steps ?? STEPS} {...props} onClose={onClose} />);
  await waitFor(() => expect(mockHighlightWithComment).toHaveBeenCalled());
  return { ...result, onClose };
}

describe('BubbleTour', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHighlightWithComment.mockResolvedValue(undefined);
    mockResolveWithRetry.mockImplementation((target: string) =>
      Promise.resolve({ element: document.createElement('div'), resolvedSelector: target })
    );
  });

  it('resolves the first step target and offers no previous callback', async () => {
    await renderTour();

    expect(mockResolveWithRetry).toHaveBeenCalledWith('#one', 'highlight');
    expect(lastHighlight()[ARG.comment]).toBe('First');
    expect(lastHighlight()[ARG.stepInfo]).toEqual({ current: 0, total: 3, completedSteps: [] });
    expect(lastHighlight()[ARG.onPrevious]).toBeUndefined();
  });

  it('advances on next, offering a previous callback from the second step on', async () => {
    await renderTour();

    await act(async () => lastHighlight()[ARG.onNext]());

    await waitFor(() => expect(lastHighlight()[ARG.comment]).toBe('Second'));
    expect(lastHighlight()[ARG.stepInfo]).toEqual({ current: 1, total: 3, completedSteps: [0] });
    expect(typeof lastHighlight()[ARG.onPrevious]).toBe('function');
  });

  it('goes back on previous', async () => {
    await renderTour();
    await act(async () => lastHighlight()[ARG.onNext]());
    await waitFor(() => expect(lastHighlight()[ARG.comment]).toBe('Second'));

    await act(async () => lastHighlight()[ARG.onPrevious]());

    await waitFor(() => expect(lastHighlight()[ARG.comment]).toBe('First'));
  });

  describe('a bubble that outlives its step', () => {
    it('ignores next from a bubble whose step has already advanced', async () => {
      await renderTour();
      const staleNext = lastHighlight()[ARG.onNext];

      await act(async () => staleNext());
      await waitFor(() => expect(lastHighlight()[ARG.comment]).toBe('Second'));

      await act(async () => staleNext());

      expect(mockHighlightWithComment.mock.calls.map((call) => call[ARG.comment])).not.toContain('Third');
      expect(lastHighlight()[ARG.stepInfo]).toEqual({ current: 1, total: 3, completedSteps: [0] });
    });

    it('waits for a slow paint before painting the next step', async () => {
      let releaseFirst: () => void = () => {};
      mockHighlightWithComment.mockImplementation((_element: unknown, comment: string) =>
        comment === 'First' ? new Promise<void>((resolve) => (releaseFirst = resolve)) : Promise.resolve()
      );

      render(<BubbleTour steps={STEPS} onClose={jest.fn()} />);
      await waitFor(() => expect(mockHighlightWithComment).toHaveBeenCalledTimes(1));

      await act(async () => lastHighlight()[ARG.onNext]());

      expect(mockHighlightWithComment).toHaveBeenCalledTimes(1);

      await act(async () => releaseFirst());

      await waitFor(() => expect(lastHighlight()[ARG.comment]).toBe('Second'));
    });
  });

  it('clears highlights then closes from the last step', async () => {
    const { onClose } = await renderTour({ steps: [STEPS[0]!] });

    await act(async () => lastHighlight()[ARG.onNext]());

    expect(mockClearAllHighlights).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the bubble is cancelled', async () => {
    const { onClose } = await renderTour();

    await act(async () => lastHighlight()[ARG.onCancel]());

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('applies finalStepLabel only to the last step', async () => {
    await renderTour({ steps: [STEPS[0]!, STEPS[1]!], finalStepLabel: 'Start creating' });

    expect(lastHighlight()[ARG.options].nextLabel).toBeUndefined();

    await act(async () => lastHighlight()[ARG.onNext]());

    await waitFor(() => expect(lastHighlight()[ARG.options].nextLabel).toBe('Start creating'));
  });

  describe('unresolvable targets', () => {
    it('falls back to a centered comment that keeps its callbacks', async () => {
      mockResolveWithRetry.mockResolvedValue(null);
      render(<BubbleTour steps={STEPS} onClose={jest.fn()} />);

      await waitFor(() => expect(mockShowCenteredComment).toHaveBeenCalled());
      const [comment, stepInfo, , onNext] = mockShowCenteredComment.mock.calls.at(-1)!;
      expect(comment).toContain('First');
      expect(comment).toContain("isn't on screen right now");
      expect(stepInfo).toEqual({ current: 0, total: 3, completedSteps: [] });
      expect(typeof onNext).toBe('function');
      expect(mockHighlightWithComment).not.toHaveBeenCalled();
    });

    it('does not highlight when the target resolves after unmount', async () => {
      let resolveTarget: (value: unknown) => void = () => {};
      mockResolveWithRetry.mockReturnValue(new Promise((resolve) => (resolveTarget = resolve)));

      const { unmount } = render(<BubbleTour steps={STEPS} onClose={jest.fn()} />);
      unmount();

      await act(async () => {
        resolveTarget({ element: document.createElement('div') });
      });

      expect(mockHighlightWithComment).not.toHaveBeenCalled();
      expect(mockShowCenteredComment).not.toHaveBeenCalled();
    });
  });

  describe('keyboard', () => {
    it('advances on ArrowRight and goes back on ArrowLeft', async () => {
      await renderTour();

      await act(async () => {
        fireEvent.keyDown(document, { key: 'ArrowRight' });
      });
      await waitFor(() => expect(lastHighlight()[ARG.comment]).toBe('Second'));

      await act(async () => {
        fireEvent.keyDown(document, { key: 'ArrowLeft' });
      });
      await waitFor(() => expect(lastHighlight()[ARG.comment]).toBe('First'));
    });

    it('closes on Escape', async () => {
      const { onClose } = await renderTour();

      await act(async () => {
        fireEvent.keyDown(document, { key: 'Escape' });
      });

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('ignores Enter so it cannot double as next', async () => {
      await renderTour();

      await act(async () => {
        fireEvent.keyDown(document, { key: 'Enter' });
      });

      expect(lastHighlight()[ARG.comment]).toBe('First');
    });

    it.each(['input', 'textarea'])('ignores keys typed inside a %s', async (tagName) => {
      await renderTour();
      const field = document.createElement(tagName);
      document.body.appendChild(field);

      await act(async () => {
        fireEvent.keyDown(field, { key: 'ArrowRight' });
      });

      expect(lastHighlight()[ARG.comment]).toBe('First');
      field.remove();
    });

    it('closes on Escape even while a text field has focus', async () => {
      const { onClose } = await renderTour();
      const field = document.createElement('input');
      document.body.appendChild(field);

      const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true });
      await act(async () => {
        field.dispatchEvent(event);
      });

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
      field.remove();
    });

    it('ignores keys typed inside a contenteditable', async () => {
      await renderTour();
      const editable = document.createElement('div');
      editable.contentEditable = 'true';
      Object.defineProperty(editable, 'isContentEditable', { value: true });
      document.body.appendChild(editable);

      await act(async () => {
        fireEvent.keyDown(editable, { key: 'ArrowRight' });
      });

      expect(lastHighlight()[ARG.comment]).toBe('First');
      editable.remove();
    });

    it('prevents default so the floating panel cannot also act on the key', async () => {
      await renderTour();

      const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true });
      await act(async () => {
        document.dispatchEvent(event);
      });

      expect(event.defaultPrevented).toBe(true);
    });

    it('sees defaultPrevented ahead of a bubble-phase document listener mounted before it', async () => {
      // Simulates FloatingPanel: a bubble-phase `document` Escape listener registered before
      // BubbleTour mounts. Dispatching on a descendant (not `document` itself) makes capture
      // vs. bubble ordering actually matter, the way it does with real focus inside a field.
      const panelSawPrevented: boolean[] = [];
      const panelListener = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          panelSawPrevented.push(e.defaultPrevented);
        }
      };
      document.addEventListener('keydown', panelListener);

      const { onClose } = await renderTour();
      const field = document.createElement('input');
      document.body.appendChild(field);

      const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true });
      await act(async () => {
        field.dispatchEvent(event);
      });

      expect(panelSawPrevented).toEqual([true]);
      expect(onClose).toHaveBeenCalledTimes(1);

      document.removeEventListener('keydown', panelListener);
      field.remove();
    });
  });

  it('clears highlights on unmount', async () => {
    const { unmount } = await renderTour();
    mockClearAllHighlights.mockClear();

    unmount();

    expect(mockClearAllHighlights).toHaveBeenCalled();
  });

  it('clears a highlight that paints after the tour has already unmounted', async () => {
    let resolvePaint: () => void = () => {};
    mockHighlightWithComment.mockImplementation(() => new Promise<void>((resolve) => (resolvePaint = resolve)));

    const { unmount } = await renderTour();
    mockClearAllHighlights.mockClear();

    unmount();
    expect(mockClearAllHighlights).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvePaint();
    });

    expect(mockClearAllHighlights).toHaveBeenCalledTimes(2);
  });
});
