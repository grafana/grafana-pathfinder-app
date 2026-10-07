import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CompletionObservationProvider } from './completion-observation-provider';
import { useObservedCompletion } from '../../global-state/observation/use-observed-completion';
import { markStepCompleted } from '../../global-state/completion-store';
import { StorageEvents } from '../../lib/event-names';
import { CompletionCoordinator, resetHeldRequestsForTests } from '../../global-state/observation/coordinator';

const mockCheck = jest.fn();
const mockListen = jest.fn(() => () => {});
jest.mock('@grafana/runtime', () => ({ locationService: { getHistory: () => ({ listen: mockListen }) } }));
jest.mock('../../requirements-manager', () => ({
  useGuideRequirements: () => ({ checkPostconditions: mockCheck }),
  splitGuideScopedRequirements: jest.requireActual('../../requirements-manager/controller-requirements')
    .splitGuideScopedRequirements,
}));
jest.mock('../../interactive-engine', () =>
  jest.requireActual('../../interactive-engine/auto-completion/passive-action')
);
jest.mock('../../global-state/controller-channel', () => ({
  useControllerChannel: () => null,
  useControllerConnected: () => false,
}));
jest.mock('../../global-state/content-key', () => ({ getContentKey: () => 'guide' }));
jest.mock('../../global-state/completion-store', () => ({
  useStepCompletion: () => ({ completed: false }),
  markStepCompleted: jest.fn(),
  readStepCompletion: async () => false,
}));
jest.mock('../../lib/context-event-bus', () => ({ onContextChange: () => () => {} }));
jest.mock('../../lib/analytics', () => ({
  reportAppInteraction: jest.fn(),
  buildInteractiveStepProperties: (properties: object) => properties,
  UserInteraction: { StepAutoCompleted: 'auto' },
}));
jest.mock('../../lib/dom', () => ({
  querySelectorAllEnhanced: (selector: string) => ({ elements: [...document.querySelectorAll(selector)] }),
  findButtonByText: () => [],
}));
jest.mock('../../lib/dom/selector-resolver', () => ({ resolveSelector: (selector: string) => selector }));

function Step({
  objectives,
  executing = false,
  onComplete,
}: {
  objectives?: string[];
  executing?: boolean;
  onComplete: () => void;
}) {
  const observation = useObservedCompletion({
    stepId: 'step',
    objectives,
    executing,
    eligible: true,
    onComplete,
    actions: [
      { targetAction: 'button', refTarget: '#first' },
      { targetAction: 'button', refTarget: '#last' },
    ],
    analytics: { location: 'test', targetAction: 'multistep', stepMeta: { stepId: 'step' } },
  });
  return (
    <button onClick={() => observation.complete()}>{observation.waiting ? 'Waiting for completion' : 'Assist'}</button>
  );
}

afterEach(() => {
  resetHeldRequestsForTests();
});

beforeEach(() => {
  jest.clearAllMocks();
  mockCheck.mockResolvedValue({ pass: false, verdict: 'unmet' });
});

it('observes a manual composite sequence without starting assistance', async () => {
  const done = jest.fn();
  render(
    <>
      <button id="first">First</button>
      <button id="last">Last</button>
      <CompletionObservationProvider contentKey="guide">
        <Step onComplete={done} />
      </CompletionObservationProvider>
    </>
  );
  fireEvent.click(screen.getByText('Last'));
  expect(done).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('First'));
  fireEvent.click(screen.getByText('Last'));
  await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
  expect(markStepCompleted).toHaveBeenCalledWith('step', undefined, 'observed', 'guide');
});

it('keeps assisted completion pending until objectives are satisfied', async () => {
  const done = jest.fn();
  render(
    <CompletionObservationProvider contentKey="guide">
      <Step objectives={['has-datasources']} onComplete={done} />
    </CompletionObservationProvider>
  );
  fireEvent.click(screen.getByText('Assist'));
  await screen.findByText('Waiting for completion');
  expect(done).not.toHaveBeenCalled();
  mockCheck.mockResolvedValue({ pass: true, verdict: 'satisfied' });
  act(() => {
    window.dispatchEvent(new Event('focus'));
  });
  await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
  expect(markStepCompleted).toHaveBeenCalledWith('step', undefined, 'objectives', 'guide');
});

it('ignores an invalid objective even when its prerequisite-style pass flag is true', async () => {
  const done = jest.fn();
  mockCheck.mockResolvedValue({ pass: true, verdict: 'invalid' });
  render(
    <CompletionObservationProvider contentKey="guide">
      <Step objectives={['Some legacy prose']} onComplete={done} />
    </CompletionObservationProvider>
  );
  fireEvent.click(screen.getByText('Assist'));
  await screen.findByText('Waiting for completion');
  expect(done).not.toHaveBeenCalled();
});

it('clears partial action progress on reset and stops observing after closing', async () => {
  const done = jest.fn();
  const root = render(
    <>
      <button id="first">First</button>
      <button id="last">Last</button>
      <CompletionObservationProvider contentKey="guide">
        <Step onComplete={done} />
      </CompletionObservationProvider>
    </>
  );
  fireEvent.click(screen.getByText('First'));
  act(() => {
    window.dispatchEvent(new CustomEvent(StorageEvents.InteractiveProgressCleared, { detail: { contentKey: '*' } }));
  });
  fireEvent.click(screen.getByText('Last'));
  await act(async () => {});
  expect(done).not.toHaveBeenCalled();
  root.unmount();
  document.body.innerHTML = '<button id="first">First</button><button id="last">Last</button>';
  fireEvent.click(document.querySelector('#first')!);
  fireEvent.click(document.querySelector('#last')!);
  expect(done).not.toHaveBeenCalled();
  document.body.replaceChildren();
});

it('keeps observing children mounted inside a collapsed section', async () => {
  const done = jest.fn();
  mockCheck.mockResolvedValue({ pass: true, verdict: 'satisfied' });
  render(
    <CompletionObservationProvider contentKey="guide">
      <ol hidden>
        <li>
          <Step objectives={['has-datasources']} onComplete={done} />
        </li>
      </ol>
    </CompletionObservationProvider>
  );
  await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
});

it('does not reuse an old guide check after a keyed guide switch', async () => {
  let finish!: (result: object) => void;
  mockCheck.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const oldDone = jest.fn();
  const newDone = jest.fn();
  const root = render(
    <CompletionObservationProvider key="old" contentKey="old">
      <Step objectives={['has-datasources']} onComplete={oldDone} />
    </CompletionObservationProvider>
  );
  await waitFor(() => expect(mockCheck).toHaveBeenCalledTimes(1));
  root.rerender(
    <CompletionObservationProvider key="new" contentKey="new">
      <Step objectives={['has-datasources']} onComplete={newDone} />
    </CompletionObservationProvider>
  );
  await act(async () => {
    finish({ pass: true, verdict: 'satisfied' });
  });
  expect(oldDone).not.toHaveBeenCalled();
  expect(newDone).not.toHaveBeenCalled();
});

it('fails closed on timeout, deduplicates unresolved requests, and clears timers on close', async () => {
  jest.useFakeTimers();
  const done = jest.fn();
  mockCheck.mockImplementation(() => new Promise(() => {}));
  const root = render(
    <CompletionObservationProvider contentKey="guide">
      <Step objectives={['has-datasources']} onComplete={done} />
    </CompletionObservationProvider>
  );
  await act(async () => {});
  expect(mockCheck).toHaveBeenCalledTimes(1);
  await act(async () => {
    jest.advanceTimersByTime(5001);
  });
  expect(done).not.toHaveBeenCalled();
  expect(mockCheck).toHaveBeenCalledTimes(1);
  root.unmount();
  await act(async () => {});
  jest.runAllTicks();
  expect(jest.getTimerCount()).toBe(0);
  jest.useRealTimers();
});

it('completes a formfill step when the reader picks the value from a dropdown', async () => {
  const done = jest.fn();
  function FormStep() {
    useObservedCompletion({
      stepId: 'pick-scenario',
      executing: false,
      eligible: true,
      onComplete: done,
      actions: [{ targetAction: 'formfill', refTarget: 'input[aria-label="scenario"]', targetValue: 'Random Walk' }],
      analytics: { location: 'test', targetAction: 'formfill', stepMeta: { stepId: 'pick-scenario' } },
    });
    return null;
  }
  render(
    <>
      <div>
        <div id="selection">Choose</div>
        <div>
          <input role="combobox" aria-autocomplete="list" aria-label="scenario" />
        </div>
      </div>
      <div role="listbox">
        <div
          role="option"
          onClick={() => {
            document.querySelector('#selection')!.textContent = 'Random Walk';
          }}
        >
          Random Walk
        </div>
      </div>
      <CompletionObservationProvider contentKey="guide">
        <FormStep />
      </CompletionObservationProvider>
    </>
  );
  expect(done).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('option'));
  await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
  expect(markStepCompleted).toHaveBeenCalledWith('pick-scenario', undefined, 'observed', 'guide');
});

it('frees a check slot once a hung check times out', async () => {
  jest.useFakeTimers();
  try {
    mockCheck.mockImplementation(({ requirements }: { requirements: string[] }) =>
      requirements[0] === 'has-datasources'
        ? Promise.resolve({ pass: true, verdict: 'satisfied' })
        : new Promise(() => {})
    );
    const done = jest.fn();
    function ObjectiveStep({ stepId, objective }: { stepId: string; objective: string }) {
      useObservedCompletion({
        stepId,
        objectives: [objective],
        executing: false,
        eligible: true,
        onComplete: objective === 'has-datasources' ? done : undefined,
        actions: [{ targetAction: 'noop' }],
        analytics: { location: 'test', targetAction: 'noop', stepMeta: { stepId } },
      });
      return null;
    }
    render(
      <CompletionObservationProvider contentKey="guide">
        {['on-page:/a', 'on-page:/b', 'on-page:/c', 'on-page:/d'].map((objective) => (
          <ObjectiveStep key={objective} stepId={objective} objective={objective} />
        ))}
        <ObjectiveStep stepId="ready" objective="has-datasources" />
      </CompletionObservationProvider>
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(4100);
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5100);
    });
    expect(done).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});

it("drops other guides' held requests when all progress is reset", async () => {
  const commitElsewhere = jest.fn();
  const elsewhere = {
    id: 'elsewhere/step',
    guideKey: 'elsewhere',
    stepId: 'step',
    actions: [{ targetAction: 'button', refTarget: '#save' }],
    verify: ['on-page:/done'],
    eligible: true,
    executing: false,
    completed: false,
    commit: commitElsewhere,
  };
  const left = new CompletionCoordinator(async () => false);
  const unregister = left.register(elsewhere);
  left.request(elsewhere.id);
  unregister();

  render(
    <CompletionObservationProvider contentKey="guide">
      <Step onComplete={jest.fn()} />
    </CompletionObservationProvider>
  );
  act(() => {
    window.dispatchEvent(new CustomEvent(StorageEvents.InteractiveProgressCleared, { detail: { contentKey: '*' } }));
  });

  const reopened = new CompletionCoordinator(async () => true);
  reopened.start();
  reopened.register({ ...elsewhere });
  await act(async () => {});
  expect(commitElsewhere).not.toHaveBeenCalled();
  reopened.stop();
});
