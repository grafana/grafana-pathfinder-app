import React, { useEffect } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Button, type ButtonProps } from '@grafana/ui';
import { RecordModeOverlay, type RecordModeOverlayProps } from './RecordModeOverlay';
import { useActionRecorder } from '../../utils/devtools/action-recorder.hook';
import { testIds } from '../../constants/testIds';

const RETURN_TITLE = 'Return to the page where recording started';
const AT_START_TITLE = 'Already at starting page';
const GROUPING_ON_TITLE = 'Multi-step grouping is ON. Click to disable.';
const GROUPING_OFF_TITLE = 'Multi-step grouping is OFF. Click to enable.';

function renderOverlay(props: Partial<RecordModeOverlayProps> = {}) {
  const onStop = jest.fn();
  const onAncestorClick = jest.fn();
  const utils = render(
    <div onClick={onAncestorClick}>
      <RecordModeOverlay onStop={onStop} stepCount={0} {...props} />
    </div>
  );
  return { ...utils, onStop, onAncestorClick };
}

function sharedButtonClass(props: Pick<ButtonProps, 'variant' | 'fill' | 'size' | 'disabled'>) {
  const { container, unmount } = render(<Button {...props}>Reference</Button>);
  const className = container.querySelector('button')!.className;
  unmount();
  return className;
}

function RecorderHarness({ onSteps }: { onSteps: (count: number) => void }) {
  const recorder = useActionRecorder({ excludeSelectors: ['[data-record-overlay]'] });
  const { startRecording } = recorder;
  useEffect(() => {
    startRecording();
  }, [startRecording]);
  useEffect(() => {
    onSteps(recorder.recordedSteps.length);
  }, [onSteps, recorder.recordedSteps.length]);
  return (
    <>
      <button type="button" data-testid="page-button">
        Page action
      </button>
      {recorder.isRecording && (
        <RecordModeOverlay
          onStop={jest.fn()}
          stepCount={0}
          startingUrl={`${window.location.origin}/#start`}
          onToggleMultiStepGrouping={jest.fn()}
        />
      )}
    </>
  );
}

describe('RecordModeOverlay', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  describe('Stop', () => {
    it('renders a native type=button control with its test ID', () => {
      renderOverlay();
      const stop = screen.getByRole('button', { name: 'Stop' });
      expect(stop.tagName).toBe('BUTTON');
      expect(stop).toHaveAttribute('type', 'button');
      expect(stop).toBe(screen.getByTestId(testIds.blockEditor.recordStopButton));
    });

    it('uses the shared destructive outline Button styles with no local overrides', () => {
      const expected = sharedButtonClass({ variant: 'destructive', fill: 'outline', size: 'sm' });
      renderOverlay();
      expect(screen.getByRole('button', { name: 'Stop' }).className).toBe(expected);
    });

    it('calls onStop once without default action or bubbling to a React ancestor', () => {
      const { onStop, onAncestorClick } = renderOverlay();
      const notCancelled = fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
      expect(notCancelled).toBe(false);
      expect(onStop).toHaveBeenCalledTimes(1);
      expect(onAncestorClick).not.toHaveBeenCalled();
    });

    it('calls onStop once when the button text is clicked', () => {
      const { onStop, onAncestorClick } = renderOverlay();
      fireEvent.click(screen.getByText('Stop'));
      expect(onStop).toHaveBeenCalledTimes(1);
      expect(onAncestorClick).not.toHaveBeenCalled();
    });

    it('still stops on Escape', () => {
      const { onStop } = renderOverlay();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onStop).toHaveBeenCalledTimes(1);
    });
  });

  describe('Return to start', () => {
    it('is absent without a starting URL', () => {
      renderOverlay();
      expect(screen.queryByRole('button', { name: 'Return to start' })).not.toBeInTheDocument();
    });

    it('uses the shared secondary outline Button styles with no local overrides', () => {
      const enabled = sharedButtonClass({ variant: 'secondary', fill: 'outline', size: 'sm' });
      const disabled = sharedButtonClass({ variant: 'secondary', fill: 'outline', size: 'sm', disabled: true });
      const { unmount } = renderOverlay({ startingUrl: `${window.location.origin}/#recording-start` });
      expect(screen.getByRole('button', { name: 'Return to start' }).className).toBe(enabled);
      unmount();

      renderOverlay({ startingUrl: window.location.href });
      expect(screen.getByRole('button', { name: 'Return to start' }).className).toBe(disabled);
    });

    it('navigates to the exact starting URL without default action or bubbling', () => {
      const startingUrl = `${window.location.origin}/#recording-start`;
      const { onAncestorClick } = renderOverlay({ startingUrl });
      const returnButton = screen.getByRole('button', { name: 'Return to start' });
      expect(returnButton).toHaveAttribute('type', 'button');
      expect(returnButton).toHaveAttribute('title', RETURN_TITLE);
      expect(returnButton).toBeEnabled();

      const notCancelled = fireEvent.click(returnButton);
      expect(notCancelled).toBe(false);
      expect(window.location.href).toBe(startingUrl);
      expect(onAncestorClick).not.toHaveBeenCalled();
    });

    it('is disabled and out of the tab order at the starting URL', () => {
      renderOverlay({ startingUrl: window.location.href });
      const returnButton = screen.getByRole('button', { name: 'Return to start' });
      expect(returnButton).toBeDisabled();
      expect(returnButton).toHaveAttribute('title', AT_START_TITLE);

      act(() => returnButton.focus());
      expect(returnButton).not.toHaveFocus();
      fireEvent.click(returnButton);
      expect(window.location.pathname).toBe('/');
      expect(window.location.hash).toBe('');
    });
  });

  describe('Auto-group', () => {
    it('is absent without the toggle callback', () => {
      renderOverlay({ isMultiStepGroupingEnabled: true });
      expect(screen.queryByRole('button', { name: 'Auto-group' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'No grouping' })).not.toBeInTheDocument();
    });

    it.each([
      { enabled: true, label: 'Auto-group', title: GROUPING_ON_TITLE },
      { enabled: false, label: 'No grouping', title: GROUPING_OFF_TITLE },
    ])('renders a focusable native button labelled $label', ({ enabled, label, title }) => {
      renderOverlay({ isMultiStepGroupingEnabled: enabled, onToggleMultiStepGrouping: jest.fn() });
      const toggle = screen.getByRole('button', { name: label });
      expect(toggle.tagName).toBe('BUTTON');
      expect(toggle).toHaveAttribute('type', 'button');
      expect(toggle).toHaveAttribute('title', title);
      expect(toggle).toBeEnabled();
      expect(toggle).not.toHaveAttribute('aria-disabled', 'true');

      act(() => toggle.focus());
      expect(toggle).toHaveFocus();
    });

    it.each([
      { enabled: true, label: 'Auto-group' },
      { enabled: false, label: 'No grouping' },
    ])('toggles once per click on $label without default action or bubbling', ({ enabled, label }) => {
      const onToggle = jest.fn();
      const { onAncestorClick } = renderOverlay({
        isMultiStepGroupingEnabled: enabled,
        onToggleMultiStepGrouping: onToggle,
      });

      const notCancelled = fireEvent.click(screen.getByRole('button', { name: label }));
      expect(notCancelled).toBe(false);
      expect(onToggle).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByText(label));
      expect(onToggle).toHaveBeenCalledTimes(2);
      expect(onAncestorClick).not.toHaveBeenCalled();
    });
  });

  it('does not record a step when the button text is clicked during recording', () => {
    const onSteps = jest.fn();
    render(<RecorderHarness onSteps={onSteps} />);

    fireEvent.click(screen.getByText('Stop'));
    fireEvent.click(screen.getByText('Return to start'));
    fireEvent.click(screen.getByText('Auto-group'));
    expect(onSteps).toHaveBeenLastCalledWith(0);

    fireEvent.click(screen.getByTestId('page-button'));
    expect(onSteps).toHaveBeenLastCalledWith(1);
  });
});
