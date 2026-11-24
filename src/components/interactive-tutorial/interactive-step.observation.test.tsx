import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { clearHeldCompletionRequests, renderWithCoordinator as render } from '../../test-utils/completion-coordinator';
import { InteractiveStep } from './interactive-step';
import { testIds } from '../../constants/testIds';
import { resetCompletionStoreForTests } from '../../global-state/completion-store';
import { subscribeProgressEvent, type ProgressReason } from '../../global-state/progress-events';

function recordStepProgress() {
  const reasons: Array<[string, ProgressReason]> = [];
  const stop = subscribeProgressEvent((event) => {
    if (event.kind === 'step' && event.completed) {
      reasons.push([event.stepId, event.reason]);
    }
  });
  return { reasons, stop };
}

let progress: ReturnType<typeof recordStepProgress>;

beforeEach(() => {
  progress = recordStepProgress();
});

afterEach(() => {
  progress.stop();
  clearHeldCompletionRequests();
  resetCompletionStoreForTests();
  document.body.innerHTML = '';
});

it('completes a top-level step when the reader clicks its button by hand', async () => {
  const saved = jest.fn();
  render(
    <>
      <button onClick={saved}>Save dashboard</button>
      <InteractiveStep stepId="top-level-save" targetAction="button" refTarget="Save dashboard">
        Save the dashboard
      </InteractiveStep>
    </>
  );
  await screen.findByTestId(testIds.interactive.doItButton('top-level-save'));

  fireEvent.click(screen.getByText('Save dashboard'));

  await waitFor(() => expect(progress.reasons).toEqual([['top-level-save', 'observed']]));
  expect(saved).toHaveBeenCalledTimes(1);
});

it('completes a top-level step when the reader clicks inside a clickable row that has no role', async () => {
  render(
    <>
      <div className="datasource-row" onClick={() => {}}>
        <span>Prometheus</span>
      </div>
      <InteractiveStep stepId="top-level-row" targetAction="highlight" refTarget="div.datasource-row">
        Pick the Prometheus data source
      </InteractiveStep>
    </>
  );
  await screen.findByTestId(testIds.interactive.doItButton('top-level-row'));

  fireEvent.click(screen.getByText('Prometheus'));

  await waitFor(() => expect(progress.reasons).toEqual([['top-level-row', 'observed']]));
});

it('credits Do it to the engine, not to an observed reader click', async () => {
  const saved = jest.fn();
  render(
    <>
      <button id="engine-save" onClick={saved}>
        Save dashboard
      </button>
      <InteractiveStep stepId="top-level-do-it" targetAction="button" refTarget="#engine-save" showMe={false}>
        Save the dashboard
      </InteractiveStep>
    </>
  );
  document.querySelector<HTMLButtonElement>('#engine-save')!.scrollIntoView = jest.fn();
  const doIt = await screen.findByTestId(testIds.interactive.doItButton('top-level-do-it'));
  await waitFor(() => expect(doIt).toBeEnabled());

  await act(async () => {
    fireEvent.click(doIt);
  });

  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(progress.reasons).toEqual([['top-level-do-it', 'manual']]));
});
