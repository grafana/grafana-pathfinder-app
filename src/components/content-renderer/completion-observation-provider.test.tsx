import React from 'react';
import { InteractiveModeContext } from '../../global-state/interactive-mode-context';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CompletionObservationProvider } from './completion-observation-provider';
import { useObservedCompletion } from '../../global-state/observation/use-observed-completion';
import { markStepCompleted } from '../../global-state/completion-store';
import { reportAppInteraction } from '../../lib/analytics';
import { StorageEvents } from '../../lib/event-names';
import { dispatchProgress } from '../../global-state/progress-events';
import { CompletionCoordinator, resetHeldRequestsForTests } from '../../global-state/observation/coordinator';

const mockCheck = jest.fn();
let mockCheckOverride: jest.Mock | undefined;
let mockAutoDetection: boolean | undefined = true;
let mockPassiveFlag = true;
let mockCheckTimeout = 4000;
jest.mock('../../hooks', () => ({
  usePathfinderPluginConfig: () => ({
    config: { enableAutoDetection: mockAutoDetection, requirementsCheckTimeout: mockCheckTimeout },
    isResolved: true,
  }),
}));
jest.mock('../../utils/openfeature', () => ({
  getFeatureFlagValue: (_name: string, fallback: boolean) =>
    _name === 'pathfinder.passive-completion' ? mockPassiveFlag : fallback,
}));
let mockControllerChannel: { post: jest.Mock; onObservation: jest.Mock; requestRequirementCheck: jest.Mock } | null =
  null;
const mockListen = jest.fn(() => () => {});
jest.mock('@grafana/runtime', () => ({ locationService: { getHistory: () => ({ listen: mockListen }) } }));
jest.mock('../../requirements-manager', () => ({
  useGuideRequirements: () => ({ checkPostconditions: mockCheckOverride ?? mockCheck }),
  splitGuideScopedRequirements: jest.requireActual('../../requirements-manager/controller-requirements')
    .splitGuideScopedRequirements,
}));
jest.mock('../../interactive-engine', () =>
  jest.requireActual('../../interactive-engine/auto-completion/passive-action')
);
jest.mock('../../global-state/controller-channel', () => ({
  useControllerChannel: () => mockControllerChannel,
  useControllerConnected: () => mockControllerChannel !== null,
}));
jest.mock('../../global-state/content-key', () => ({ getContentKey: () => 'guide' }));
jest.mock('../../global-state/completion-store', () => ({
  useStepCompletion: () => ({ completed: false }),
  markStepCompleted: jest.fn(),
  readStepCompletion: async () => false,
  isBlockEditorPreviewUrl: () => false,
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
  mockControllerChannel = null;
  mockAutoDetection = true;
  mockCheckTimeout = 4000;
  mockPassiveFlag = true;
  mockCheckOverride = undefined;
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
  expect(markStepCompleted).toHaveBeenCalledWith('step', undefined, 'observed', 'guide', 'change');
  expect(reportAppInteraction).toHaveBeenCalledTimes(1);
  expect(reportAppInteraction).toHaveBeenCalledWith(
    'auto',
    expect.objectContaining({ completion_method: 'auto_detected', internal_actions_count: 2 })
  );
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
  expect(markStepCompleted).toHaveBeenCalledWith('step', undefined, 'objectives', 'guide', 'change');
  expect(reportAppInteraction).not.toHaveBeenCalled();
});

it('records an objective already met when the guide opens as a load, not a reader change', async () => {
  mockCheck.mockResolvedValue({ pass: true, verdict: 'satisfied' });
  const done = jest.fn();
  render(
    <CompletionObservationProvider contentKey="guide">
      <Step objectives={['has-datasources']} onComplete={done} />
    </CompletionObservationProvider>
  );
  await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
  expect(markStepCompleted).toHaveBeenCalledWith('step', undefined, 'objectives', 'guide', 'load');
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

it('retries a timed-out check and clears timers on close', async () => {
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
    await jest.advanceTimersByTimeAsync(5001);
  });
  expect(done).not.toHaveBeenCalled();
  expect(mockCheck).toHaveBeenCalledTimes(2);
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
  act(() => {
    screen.getByRole('combobox').focus();
  });
  fireEvent.click(screen.getByRole('option'));
  await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
  expect(markStepCompleted).toHaveBeenCalledWith('pick-scenario', undefined, 'observed', 'guide', 'change');
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

it('backs off fallback polling while nothing happens and resets on activity', async () => {
  jest.useFakeTimers();
  try {
    render(
      <CompletionObservationProvider contentKey="guide">
        <Step objectives={['has-datasource:prometheus']} onComplete={jest.fn()} />
      </CompletionObservationProvider>
    );
    const advance = async (ms: number) => {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(ms);
      });
    };
    await advance(0);
    const atOpen = mockCheck.mock.calls.length;
    await advance(35_000);
    expect(mockCheck.mock.calls.length - atOpen).toBe(3);
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await advance(0);
    const afterFocus = mockCheck.mock.calls.length;
    await advance(5_000);
    expect(mockCheck.mock.calls.length).toBe(afterFocus + 1);
  } finally {
    jest.useRealTimers();
  }
});

it.each([
  ['the tenant opts out', () => (mockAutoDetection = false)],
  ['the fleet flag is off', () => (mockPassiveFlag = false)],
])('provides no coordinator and observes nothing when %s', async (_name, switchOff) => {
  switchOff();
  mockCheck.mockResolvedValue({ pass: true, verdict: 'satisfied' });
  const { useCompletionCoordinator } = jest.requireActual('../../global-state/observation/context');
  const seen: unknown[] = [];
  function Probe() {
    seen.push(useCompletionCoordinator());
    return null;
  }
  const done = jest.fn();
  render(
    <CompletionObservationProvider contentKey="guide">
      <Probe />
      <Step objectives={['has-datasources']} onComplete={done} />
    </CompletionObservationProvider>
  );
  await act(async () => {});
  expect(seen.every((value) => value === null)).toBe(true);
  expect(mockCheck).not.toHaveBeenCalled();
  expect(done).not.toHaveBeenCalled();
});

it('keeps observing when the tenant has never stored the setting', async () => {
  mockAutoDetection = undefined;
  mockCheck.mockResolvedValue({ pass: true, verdict: 'satisfied' });
  const done = jest.fn();
  render(
    <CompletionObservationProvider contentKey="guide">
      <Step objectives={['has-datasources']} onComplete={done} />
    </CompletionObservationProvider>
  );
  await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
});

it('rechecks objectives soon after the reader acts elsewhere in Grafana', async () => {
  jest.useFakeTimers();
  try {
    render(
      <>
        <button>Save</button>
        <CompletionObservationProvider contentKey="guide">
          <Step objectives={['has-datasource:prometheus']} onComplete={jest.fn()} />
        </CompletionObservationProvider>
      </>
    );
    const advance = async (ms: number) => {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(ms);
      });
    };
    await advance(35_000);
    const idle = mockCheck.mock.calls.length;
    fireEvent.mouseOver(screen.getByText('Save'));
    await advance(1000);
    expect(mockCheck.mock.calls.length).toBe(idle);
    fireEvent.click(screen.getByText('Save'));
    await advance(300);
    expect(mockCheck.mock.calls.length).toBe(idle + 1);
  } finally {
    jest.useRealTimers();
  }
});

it('forgets fields the reader touched before progress was reset', async () => {
  jest.useFakeTimers();
  try {
    const done = jest.fn();
    function FormStep() {
      useObservedCompletion({
        stepId: 'set-url',
        executing: false,
        eligible: true,
        onComplete: done,
        actions: [
          { targetAction: 'formfill', refTarget: 'input[aria-label="url"]', targetValue: 'http://localhost:9090' },
        ],
        analytics: { location: 'test', targetAction: 'formfill', stepMeta: { stepId: 'set-url' } },
      });
      return null;
    }
    render(
      <>
        <input aria-label="url" defaultValue="http://localhost:9090" />
        <button>Elsewhere</button>
        <CompletionObservationProvider contentKey="guide">
          <FormStep />
        </CompletionObservationProvider>
      </>
    );
    const advance = async (ms: number) => {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(ms);
      });
    };
    act(() => {
      screen.getByLabelText('url').focus();
    });
    act(() => {
      window.dispatchEvent(new CustomEvent(StorageEvents.InteractiveProgressCleared, { detail: { contentKey: '*' } }));
    });
    fireEvent.click(screen.getByText('Elsewhere'));
    await advance(500);
    expect(done).not.toHaveBeenCalled();
    act(() => {
      screen.getByText('Elsewhere').focus();
      screen.getByLabelText('url').focus();
    });
    fireEvent.click(screen.getByText('Elsewhere'));
    await advance(500);
    expect(done).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});

it('keeps other steps observed when one step is reset', async () => {
  jest.useFakeTimers();
  try {
    const done: Record<string, jest.Mock> = { a: jest.fn(), b: jest.fn() };
    function FormStep({ id }: { id: 'a' | 'b' }) {
      useObservedCompletion({
        stepId: id,
        executing: false,
        eligible: true,
        onComplete: done[id],
        actions: [{ targetAction: 'formfill', refTarget: `input[aria-label="${id}"]`, targetValue: 'ready' }],
        analytics: { location: 'test', targetAction: 'formfill', stepMeta: { stepId: id } },
      });
      return null;
    }
    render(
      <>
        <input aria-label="a" defaultValue="ready" />
        <input aria-label="b" defaultValue="ready" />
        <button>Elsewhere</button>
        <CompletionObservationProvider contentKey="guide">
          <FormStep id="a" />
          <FormStep id="b" />
        </CompletionObservationProvider>
      </>
    );
    const advance = async (ms: number) => {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(ms);
      });
    };
    act(() => {
      screen.getByLabelText('a').focus();
      screen.getByLabelText('b').focus();
    });
    act(() => {
      dispatchProgress({ kind: 'step', stepId: 'a', completed: false, reason: 'none' });
    });
    fireEvent.click(screen.getByText('Elsewhere'));
    await advance(500);
    expect(done.b).toHaveBeenCalledTimes(1);
    expect(done.a).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

it('leaves other sections observed when one section is reset', async () => {
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
  fireEvent.click(screen.getByText('First'));
  act(() => {
    window.dispatchEvent(
      new CustomEvent(StorageEvents.InteractiveProgressCleared, { detail: { contentKey: 'guide', sectionId: 'other' } })
    );
  });
  fireEvent.click(screen.getByText('Last'));
  await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
});

it('uses the configured timeout and accepts a fresh result after an old request times out', async () => {
  jest.useFakeTimers();
  try {
    mockCheckTimeout = 100;
    let finishOld!: (result: { verdict: string }) => void;
    mockCheck.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        })
    );
    const done = jest.fn();
    const view = render(
      <CompletionObservationProvider contentKey="guide">
        <Step objectives={['has-datasources']} onComplete={done} />
      </CompletionObservationProvider>
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(101);
    });
    expect(done).not.toHaveBeenCalled();
    mockCheck.mockResolvedValue({ verdict: 'satisfied' });
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(mockCheck).toHaveBeenCalledTimes(2);
    expect(done).toHaveBeenCalledTimes(1);
    await act(async () => finishOld({ verdict: 'unsatisfied' }));
    expect(done).toHaveBeenCalledTimes(1);
    view.unmount();
  } finally {
    jest.useRealTimers();
  }
});

it('ignores progress reset events for another guide', async () => {
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
  fireEvent.click(screen.getByText('First'));
  act(() =>
    window.dispatchEvent(
      new CustomEvent(StorageEvents.InteractiveProgressCleared, { detail: { contentKey: 'other-guide' } })
    )
  );
  fireEvent.click(screen.getByText('Last'));
  await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
});

it('coalesces controller subscription updates when several steps register together', async () => {
  jest.useFakeTimers();
  try {
    mockControllerChannel = {
      post: jest.fn(),
      onObservation: jest.fn(() => () => {}),
      requestRequirementCheck: jest.fn(),
    };
    function ObservedStep({ id }: { id: string }) {
      useObservedCompletion({
        stepId: id,
        executing: false,
        eligible: true,
        actions: [{ targetAction: 'button', refTarget: '#first' }],
        analytics: { location: 'test', targetAction: 'button', stepMeta: { stepId: id } },
      });
      return null;
    }
    const tree = (count: number) => (
      <InteractiveModeContext.Provider value="controller">
        <CompletionObservationProvider contentKey="guide">
          {Array.from({ length: count }, (_, index) => (
            <ObservedStep key={index} id={String(index)} />
          ))}
        </CompletionObservationProvider>
      </InteractiveModeContext.Provider>
    );
    const view = render(tree(1));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(51);
    });
    mockControllerChannel.post.mockClear();
    view.rerender(tree(10));
    expect(mockControllerChannel.post).not.toHaveBeenCalled();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(51);
    });
    expect(mockControllerChannel.post).toHaveBeenCalledTimes(1);
    expect(mockControllerChannel.post.mock.calls[0][0].steps).toHaveLength(10);
    view.unmount();
  } finally {
    jest.useRealTimers();
  }
});

it('keeps one coordinator and its session progress when the requirement checker changes', async () => {
  const done = jest.fn();
  const { useCompletionCoordinator } = jest.requireActual('../../global-state/observation/context');
  const seen = new Set<unknown>();
  function Probe() {
    seen.add(useCompletionCoordinator());
    return null;
  }
  function ObjectiveStep() {
    useObservedCompletion({
      stepId: 'objective',
      objectives: ['has-datasources'],
      executing: false,
      eligible: true,
      actions: [{ targetAction: 'noop' }],
      analytics: { location: 'test', targetAction: 'noop', stepMeta: { stepId: 'objective' } },
    });
    return null;
  }
  const tree = () => (
    <>
      <button id="first">First</button>
      <button id="last">Last</button>
      <CompletionObservationProvider contentKey="guide">
        <Probe />
        <Step onComplete={done} />
        <ObjectiveStep />
      </CompletionObservationProvider>
    </>
  );
  const root = render(tree());
  fireEvent.click(screen.getByText('First'));
  mockCheckOverride = jest.fn().mockResolvedValue({ pass: false, verdict: 'unsatisfied' });
  root.rerender(tree());
  act(() => {
    window.dispatchEvent(new Event('focus'));
  });
  await waitFor(() => expect(mockCheckOverride).toHaveBeenCalled());
  fireEvent.click(screen.getByText('Last'));
  await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
  expect(seen.size).toBe(1);
});
