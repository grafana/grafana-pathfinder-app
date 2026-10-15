import { act, renderHook } from '@testing-library/react';
import { locationService } from '@grafana/runtime';
import { useSectionRecovery, type SectionRecoveryEvent } from './use-section-recovery';
import { deriveSectionRecoveryPlan } from '../../../recovery/section-recovery-plan';

jest.mock('../../../interactive-engine', () => ({
  NavigationManager: class {
    async fixLocationRequirement(path: string) {
      locationService.push(path);
      return true;
    }
    async fixNavigationRequirements() {}
  },
}));

const plan = deriveSectionRecoveryPlan(
  [
    { stepId: 'open', kind: 'plain', targetAction: 'highlight', refTarget: '#row', targetState: 'aria-expanded:true' },
    {
      stepId: 'run',
      kind: 'plain',
      targetAction: 'highlight',
      refTarget: '#run',
      requirements: ['on-page:/explore'],
    },
  ],
  1,
  new Set()
);

function where() {
  const { pathname, search } = locationService.getLocation();
  return pathname + search;
}

async function wait(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  document.body.innerHTML = '<button id="row" aria-expanded="true">Row</button><button id="run">Run</button>';
  locationService.push('/explore?left=keep-me');
});
afterEach(() => jest.useRealTimers());

it('pauses when the learner leaves the page, and Restore returns them with their query intact', async () => {
  const events: SectionRecoveryEvent[] = [];
  const { result } = renderHook(() =>
    useSectionRecovery(plan, 'section', true, false, { onEvent: (event) => events.push(event) })
  );
  await wait(0);
  expect(result.current.paused).toBe(false);

  await act(async () => {
    locationService.push('/dashboards');
  });
  await wait(750);
  await wait(750);
  expect(result.current.paused).toBe(true);
  expect(events).toContainEqual(expect.objectContaining({ kind: 'paused', locationRestore: true }));

  let restored!: Promise<boolean>;
  act(() => {
    restored = result.current.restore();
  });
  await wait(5000);
  expect(await restored).toBe(true);
  expect(where()).toBe('/explore?left=keep-me');
  expect(result.current.paused).toBe(false);
  expect(events.at(-1)).toEqual({ kind: 'resolved', resolvedBy: 'restore' });
});

it('remembers the page a step was ready on, not the page the learner is leaving for', async () => {
  const targetOnly = deriveSectionRecoveryPlan(
    [{ stepId: 'look', kind: 'plain', targetAction: 'hover', refTarget: '#run' }],
    0,
    new Set()
  );
  const { result } = renderHook(() => useSectionRecovery(targetOnly, 'section', true, false));
  await wait(0);

  await act(async () => {
    locationService.push('/dashboards');
    setTimeout(() => document.getElementById('run')?.remove(), 300);
  });
  await wait(750);
  await wait(750);
  expect(result.current.paused).toBe(true);

  const unlisten = locationService.getHistory().listen(({ pathname }) => {
    if (pathname === '/explore') {
      document.body.insertAdjacentHTML('beforeend', '<button id="run">Run</button>');
    }
  });
  let restored!: Promise<boolean>;
  act(() => {
    restored = result.current.restore();
  });
  await wait(5000);
  unlisten();
  expect(await restored).toBe(true);
  expect(where()).toBe('/explore?left=keep-me');
});

it('stays quiet while a step runs, even when the page changes under it', async () => {
  const { result, rerender } = renderHook(
    ({ suspended }) => useSectionRecovery(plan, 'section', true, false, { suspended }),
    { initialProps: { suspended: false } }
  );
  await wait(0);
  rerender({ suspended: true });
  await act(async () => {
    locationService.push('/dashboards');
  });
  await wait(6000);
  expect(result.current.paused).toBe(false);
});
