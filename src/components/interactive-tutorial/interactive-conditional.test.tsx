import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';

import { testIds } from '../../constants/testIds';
import { InteractiveConditional } from './interactive-conditional';

const checkRequirementsFromData = jest.fn();

jest.mock('../../interactive-engine', () => ({
  useInteractiveElements: () => ({
    checkRequirementsFromData,
  }),
}));

describe('InteractiveConditional', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    checkRequirementsFromData.mockReset();
    checkRequirementsFromData.mockResolvedValue({ pass: false, requirements: '', error: [] });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const renderConditional = (pass: boolean) => {
    checkRequirementsFromData.mockResolvedValue({ pass, requirements: '', error: [] });
    return render(
      <InteractiveConditional
        conditions={['exists-reftarget']}
        reftarget={'button[data-testid="data-testid Tab Visualizations"]'}
        whenTrueChildren={[
          {
            type: 'interactive-step',
            props: { targetAction: 'highlight', refTarget: '.when-true-step' },
            children: [],
          },
        ]}
        whenFalseChildren={[]}
        renderElement={(element, childKey) => (
          <div data-testid={`rendered-${childKey}`} key={childKey}>
            {element.type}
          </div>
        )}
        keyPrefix="test"
      />
    );
  };

  it('shows whenTrue branch after interactive-action-completed without remounting', async () => {
    renderConditional(false);

    await act(async () => {
      jest.runAllTimers();
    });

    expect(screen.queryByTestId('rendered-test-true-0')).not.toBeInTheDocument();

    checkRequirementsFromData.mockResolvedValue({ pass: true, requirements: '', error: [] });

    await act(async () => {
      document.dispatchEvent(new CustomEvent('interactive-action-completed', { detail: {} }));
      jest.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(screen.getByTestId('rendered-test-true-0')).toBeInTheDocument();
    });
  });

  it('re-evaluates on interactive-step-completed for exists-reftarget conditions', async () => {
    renderConditional(false);

    await act(async () => {
      jest.runAllTimers();
    });

    checkRequirementsFromData.mockResolvedValue({ pass: true, requirements: '', error: [] });

    await act(async () => {
      window.dispatchEvent(new CustomEvent('interactive-step-completed', { detail: { stepId: 'prior-step' } }));
      jest.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(screen.getByTestId('rendered-test-true-0')).toBeInTheDocument();
    });
  });

  it('does not show loading spinner on re-evaluation when branch was already resolved', async () => {
    checkRequirementsFromData.mockResolvedValue({ pass: true, requirements: '', error: [] });

    render(
      <InteractiveConditional
        conditions={['exists-reftarget']}
        reftarget="button.tab"
        whenTrueChildren={[
          {
            type: 'interactive-step',
            props: { targetAction: 'highlight', refTarget: '.step' },
            children: [],
          },
        ]}
        whenFalseChildren={[]}
        renderElement={() => <div>child</div>}
        keyPrefix="k"
      />
    );

    await act(async () => {
      jest.runAllTimers();
    });

    expect(screen.getByText('child')).toBeInTheDocument();
    expect(screen.queryByText('Checking conditions...')).not.toBeInTheDocument();

    checkRequirementsFromData.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ pass: false, requirements: '', error: [] }), 500);
        })
    );

    await act(async () => {
      document.dispatchEvent(new CustomEvent('interactive-action-completed', { detail: {} }));
      jest.advanceTimersByTime(300);
    });

    // Branch stays visible while re-check is in flight (no loading takeover)
    expect(screen.getByText('child')).toBeInTheDocument();
    expect(screen.queryByText('Checking conditions...')).not.toBeInTheDocument();
  });

  it('exposes conditional test id after evaluation', async () => {
    renderConditional(true);

    await act(async () => {
      jest.runAllTimers();
    });

    await waitFor(() => {
      expect(screen.getByTestId(testIds.interactive.conditional('exists-reftarget'))).toHaveAttribute(
        'data-passed',
        'true'
      );
    });
  });
});
