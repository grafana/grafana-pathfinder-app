import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { clearHeldCompletionRequests, renderWithCoordinator as render } from '../../test-utils/completion-coordinator';
import { InteractiveStep } from './interactive-step';
import { testIds } from '../../constants/testIds';
import { resetCompletionStoreForTests } from '../../global-state/completion-store';
import { subscribeProgressEvent, type ProgressOrigin, type ProgressReason } from '../../global-state/progress-events';
import { getContentKey } from '../../global-state/content-key';
import { publishGuideIndex } from '../../global-state/active-guide-index';
import { computeGuideBlockIndex } from '../../lib/guide-stats';
import { __notifyContextChangeForTests } from '../../lib/context-event-bus';
import { locationService } from '@grafana/runtime';
import { InteractiveModeContext } from '../../global-state/interactive-mode-context';

function recordStepProgress() {
  const reasons: Array<[string, ProgressReason]> = [];
  const guideOrigins: Array<ProgressOrigin | undefined> = [];
  const stop = subscribeProgressEvent((event) => {
    if (event.kind === 'step' && event.completed) {
      reasons.push([event.stepId, event.reason]);
    } else if (event.kind === 'guide') {
      guideOrigins.push(event.origin);
    }
  });
  return { reasons, guideOrigins, stop };
}

let progress: ReturnType<typeof recordStepProgress>;

beforeEach(() => {
  progress = recordStepProgress();
});

function publishSingleStepGuide(stepId: string) {
  publishGuideIndex({
    contentKey: getContentKey(),
    index: computeGuideBlockIndex([{ type: 'markdown', id: stepId }, { type: 'markdown' }]),
    denominatorSource: 'live-pre-inlining',
  });
}

afterEach(() => {
  progress.stop();
  clearHeldCompletionRequests();
  resetCompletionStoreForTests();
  document.body.innerHTML = '';
});

async function expectStillOpen(stepId: string) {
  const doIt = await screen.findByTestId(testIds.interactive.doItButton(stepId));
  await waitFor(() => expect(doIt).toBeEnabled());
  expect(progress.reasons).toEqual([]);
  return doIt;
}

it('completes a top-level step whose control already sits in its target state, without clicking it', async () => {
  publishSingleStepGuide('expanded-options');
  const toggled = jest.fn();
  render(
    <>
      <button aria-expanded="true" onClick={toggled}>
        Query options
      </button>
      <InteractiveStep stepId="expanded-options" targetAction="button" refTarget="Query options" targetState={true}>
        Open the query options
      </InteractiveStep>
    </>
  );

  await waitFor(() => expect(progress.reasons).toEqual([['expanded-options', 'objectives']]));
  expect(toggled).not.toHaveBeenCalled();
  expect(progress.guideOrigins.at(-1)).toBe('load');
});

it('completes a top-level highlight step on a switch that is already on', async () => {
  render(
    <>
      <label>
        Shared crosshair
        <input id="crosshair" type="checkbox" role="switch" defaultChecked />
      </label>
      <InteractiveStep stepId="crosshair-on" targetAction="highlight" refTarget="#crosshair" targetState={true}>
        Turn on the shared crosshair
      </InteractiveStep>
    </>
  );

  await waitFor(() => expect(progress.reasons).toEqual([['crosshair-on', 'objectives']]));
});

it('completes a top-level step once the reader reaches a page where its control is already in its target state', async () => {
  publishSingleStepGuide('later-options');
  render(
    <InteractiveStep stepId="later-options" targetAction="button" refTarget="Query options" targetState={true}>
      Open the query options
    </InteractiveStep>
  );
  await expectStillOpen('later-options');

  const control = document.createElement('button');
  control.setAttribute('aria-expanded', 'true');
  control.textContent = 'Query options';
  document.body.appendChild(control);
  act(() => __notifyContextChangeForTests());

  await waitFor(() => expect(progress.reasons).toEqual([['later-options', 'objectives']]));
  expect(progress.guideOrigins.at(-1)).toBe('load');
});

it('keeps an unsatisfied top-level step open, and Do it still toggles the control', async () => {
  const toggled = jest.fn();
  render(
    <>
      <button id="options" aria-expanded="false" onClick={toggled}>
        Query options
      </button>
      <InteractiveStep
        stepId="collapsed-options"
        targetAction="button"
        refTarget="#options"
        targetState={true}
        showMe={false}
      >
        Open the query options
      </InteractiveStep>
    </>
  );
  document.querySelector<HTMLButtonElement>('#options')!.scrollIntoView = jest.fn();

  const doIt = await expectStillOpen('collapsed-options');
  await act(async () => {
    fireEvent.click(doIt);
  });

  await waitFor(() => expect(toggled).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(progress.reasons).toEqual([['collapsed-options', 'manual']]));
});

it('saves a control that moves into its target state after the reader arrived as a change', async () => {
  publishSingleStepGuide('flipped-options');
  render(
    <>
      <button id="options" aria-expanded="false">
        Query options
      </button>
      <InteractiveStep stepId="flipped-options" targetAction="button" refTarget="#options" targetState={true}>
        Open the query options
      </InteractiveStep>
    </>
  );
  await expectStillOpen('flipped-options');

  document.querySelector('#options')!.setAttribute('aria-expanded', 'true');
  act(() => __notifyContextChangeForTests());

  await waitFor(() => expect(progress.reasons).toEqual([['flipped-options', 'objectives']]));
  expect(progress.guideOrigins.at(-1)).toBe('change');
});

it('never completes a step that has no authored target state', async () => {
  render(
    <>
      <button aria-expanded="true">Query options</button>
      <InteractiveStep stepId="no-target-state" targetAction="button" refTarget="Query options">
        Open the query options
      </InteractiveStep>
    </>
  );

  await expectStillOpen('no-target-state');
});

it('keeps a step open when its control exposes no readable state', async () => {
  render(
    <>
      <button>Query options</button>
      <InteractiveStep stepId="unreadable-state" targetAction="button" refTarget="Query options" targetState={true}>
        Open the query options
      </InteractiveStep>
    </>
  );

  await expectStillOpen('unreadable-state');
});

it('leaves completion to authored objectives even when the control is already in its target state', async () => {
  locationService.push('/explore');
  render(
    <>
      <button aria-expanded="true">Query options</button>
      <InteractiveStep
        stepId="objectives-first"
        targetAction="button"
        refTarget="Query options"
        targetState={true}
        objectives="on-page:/query-options"
      >
        Open the query options
      </InteractiveStep>
    </>
  );
  await expectStillOpen('objectives-first');

  act(() => locationService.push('/query-options'));
  act(() => __notifyContextChangeForTests());

  await waitFor(() => expect(progress.reasons).toEqual([['objectives-first', 'objectives']]));
});

it('keeps a Do it waiting on its unmet verify after the control reaches its target state', async () => {
  const onClick = jest.fn((event: React.MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.setAttribute('aria-expanded', 'true');
    __notifyContextChangeForTests();
  });
  render(
    <>
      <button id="options" aria-expanded="false" onClick={onClick}>
        Query options
      </button>
      <InteractiveStep
        stepId="verify-waits"
        targetAction="button"
        refTarget="#options"
        targetState={true}
        postVerify="on-page:/never-here"
        showMe={false}
      >
        Open the query options
      </InteractiveStep>
    </>
  );
  document.querySelector<HTMLButtonElement>('#options')!.scrollIntoView = jest.fn();

  const doIt = await expectStillOpen('verify-waits');
  await act(async () => {
    fireEvent.click(doIt);
  });
  await waitFor(() => expect(onClick).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(document.querySelector('[data-test-step-state]')).toHaveAttribute('data-test-step-state', 'waiting')
  );
  act(() => __notifyContextChangeForTests());

  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(progress.reasons).toEqual([]);
});

it('saves a Do it whose click lands the target state mid-run as manual', async () => {
  const onClick = jest.fn((event: React.MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.setAttribute('aria-expanded', 'true');
    __notifyContextChangeForTests();
  });
  render(
    <>
      <button id="options" aria-expanded="false" onClick={onClick}>
        Query options
      </button>
      <InteractiveStep stepId="assisted" targetAction="button" refTarget="#options" targetState={true} showMe={false}>
        Open the query options
      </InteractiveStep>
    </>
  );
  document.querySelector<HTMLButtonElement>('#options')!.scrollIntoView = jest.fn();

  const doIt = await expectStillOpen('assisted');
  await act(async () => {
    fireEvent.click(doIt);
  });

  await waitFor(() => expect(progress.reasons).toEqual([['assisted', 'manual']]));
  expect(onClick).toHaveBeenCalledTimes(1);
});

it('keeps a step inside a section waiting for Do it when its control is already in its target state', async () => {
  render(
    <>
      <button aria-expanded="true">Query options</button>
      <InteractiveStep
        stepId="section-options-step-1"
        sectionId="section-options"
        targetAction="button"
        refTarget="Query options"
        targetState={true}
      >
        Open the query options
      </InteractiveStep>
    </>
  );

  await expectStillOpen('section-options-step-1');
});

it('leaves a hover step on an already expanded control to the reader', async () => {
  render(
    <>
      <button id="options" aria-expanded="true">
        Query options
      </button>
      <InteractiveStep stepId="hover-options" targetAction="hover" refTarget="#options" targetState={true}>
        Point at the query options
      </InteractiveStep>
    </>
  );

  await expectStillOpen('hover-options');
});

it('does not read the pop-out window as the live Grafana tab', async () => {
  render(
    <InteractiveModeContext.Provider value="controller">
      <button aria-expanded="true">Query options</button>
      <InteractiveStep stepId="pop-out-options" targetAction="button" refTarget="Query options" targetState={true}>
        Open the query options
      </InteractiveStep>
    </InteractiveModeContext.Provider>
  );

  await screen.findByTestId(testIds.interactive.doItButton('pop-out-options'));
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(progress.reasons).toEqual([]);
});
