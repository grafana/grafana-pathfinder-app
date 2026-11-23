import React, { useEffect } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { RecordModeOverlay, type RecordModeOverlayProps } from './RecordModeOverlay';
import { useActionRecorder } from '../../utils/devtools/action-recorder.hook';
import { testIds } from '../../constants/testIds';

const RETURN_TITLE = 'Return to the page where recording started';
const AT_START_TITLE = 'Already at starting page';

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
        <RecordModeOverlay onStop={jest.fn()} stepCount={0} startingUrl={`${window.location.origin}/#start`} />
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

  it('does not record a step when the button text is clicked during recording', () => {
    const onSteps = jest.fn();
    render(<RecorderHarness onSteps={onSteps} />);

    fireEvent.click(screen.getByText('Stop'));
    fireEvent.click(screen.getByText('Return to start'));
    expect(onSteps).toHaveBeenLastCalledWith(0);

    fireEvent.click(screen.getByTestId('page-button'));
    expect(onSteps).toHaveBeenLastCalledWith(1);
  });
});
