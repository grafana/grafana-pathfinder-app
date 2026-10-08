import { CompletionCoordinator, type ObservationStep } from './coordinator';

const settle = async () => {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
  }
};
const step = (overrides: Partial<ObservationStep> = {}): ObservationStep => ({
  id: 'guide/section/step',
  stepId: 'step',
  actions: [{ targetAction: 'button', refTarget: 'Save' }],
  eligible: true,
  executing: false,
  completed: false,
  commit: jest.fn(),
  ...overrides,
});

describe('guide completion observation', () => {
  it('recognises existing objectives even on a later, ineligible step', async () => {
    const check = jest.fn().mockResolvedValue(true);
    const coordinator = new CompletionCoordinator(check);
    const item = step({ eligible: false, objectives: ['has-datasource:prometheus'] });
    coordinator.register(item);
    coordinator.start();
    await settle();
    expect(item.commit).toHaveBeenCalledWith('objectives', 'load');
    coordinator.recheck();
    await settle();
    expect(item.commit).toHaveBeenCalledTimes(1);
  });

  it('does not infer earlier actions from a later click and captures rapid consecutive actions', async () => {
    const coordinator = new CompletionCoordinator(jest.fn());
    const item = step({
      actions: [
        { targetAction: 'button', refTarget: 'Open' },
        { targetAction: 'button', refTarget: 'Save' },
      ],
    });
    coordinator.register(item);
    coordinator.start();
    coordinator.observe((action) => action.refTarget === 'Save');
    expect(coordinator.cursor(item.id)).toBe(0);
    coordinator.observe((action) => action.refTarget === 'Open');
    coordinator.observe((action) => action.refTarget === 'Save');
    await settle();
    expect(item.commit).toHaveBeenCalledTimes(1);
    expect(item.commit).toHaveBeenCalledWith('observed', 'change');
  });

  it('requires separate events for repeated selectors', async () => {
    const coordinator = new CompletionCoordinator(jest.fn());
    const item = step({
      actions: [
        { targetAction: 'button', refTarget: 'Next' },
        { targetAction: 'button', refTarget: 'Next' },
      ],
    });
    coordinator.register(item);
    coordinator.start();
    coordinator.observe(() => true);
    await settle();
    expect(item.commit).not.toHaveBeenCalled();
    coordinator.observe(() => true);
    await settle();
    expect(item.commit).toHaveBeenCalledWith('observed', 'change');
  });

  it('gates assisted completion on objectives and waits for execution to settle', async () => {
    let satisfied = false;
    const coordinator = new CompletionCoordinator(async () => satisfied);
    const item = step({ objectives: ['has-dashboard-named:Example'], executing: true });
    coordinator.register(item);
    coordinator.start();
    coordinator.request(item.id);
    await settle();
    expect(item.commit).not.toHaveBeenCalled();
    coordinator.update(item.id, { ...item, executing: false });
    await settle();
    expect(coordinator.waiting(item.id)).toBe(true);
    satisfied = true;
    coordinator.recheck();
    await settle();
    expect(item.commit).toHaveBeenCalledWith('objectives', 'change');
  });

  it('does not complete from failed verification or unavailable checks', async () => {
    const check = jest.fn().mockRejectedValue(new Error('offline'));
    const coordinator = new CompletionCoordinator(check);
    const item = step({ verify: 'on-page:/saved' });
    coordinator.register(item);
    coordinator.start();
    coordinator.observe(() => true);
    await settle();
    expect(item.commit).not.toHaveBeenCalled();
    check.mockResolvedValue(true);
    coordinator.recheck();
    await settle();
    expect(item.commit).toHaveBeenCalledWith('observed', 'change');
  });

  it('queues a change that arrives during a check', async () => {
    let finish!: (value: boolean) => void;
    const check = jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            finish = resolve;
          })
      )
      .mockResolvedValue(true);
    const coordinator = new CompletionCoordinator(check);
    const item = step({ objectives: 'has-datasources' });
    coordinator.register(item);
    coordinator.start();
    coordinator.recheck();
    finish(false);
    await settle();
    expect(item.commit).toHaveBeenCalledWith('objectives', 'change');
  });

  it.each(['reset', 'stop', 'unregister'] as const)('discards stale results after %s', async (operation) => {
    let finish!: (value: boolean) => void;
    const check = jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            finish = resolve;
          })
      )
      .mockResolvedValue(false);
    const coordinator = new CompletionCoordinator(check);
    const item = step({ objectives: 'has-datasources' });
    const release = coordinator.register(item);
    coordinator.start();
    if (operation === 'unregister') {
      release();
    } else {
      coordinator[operation]();
    }
    finish(true);
    await settle();
    expect(item.commit).not.toHaveBeenCalled();
  });

  it('deduplicates identical checks and never executes command objectives passively', async () => {
    const check = jest.fn().mockResolvedValue(false);
    const coordinator = new CompletionCoordinator(check);
    coordinator.register(step({ id: 'a', objectives: 'has-datasources' }));
    coordinator.register(step({ id: 'b', objectives: 'has-datasources' }));
    const command = step({ id: 'c', objectives: 'coda-exit-zero:touch /tmp/x' });
    coordinator.register(command);
    coordinator.start();
    await settle();
    expect(check).toHaveBeenCalledTimes(1);
    expect(command.commit).not.toHaveBeenCalled();
  });

  it('does not complete an informational sequence or an ineligible action', async () => {
    const coordinator = new CompletionCoordinator(jest.fn());
    const info = step({ actions: [{ targetAction: 'noop' }] });
    const blocked = step({ id: 'blocked', eligible: false });
    coordinator.register(info);
    coordinator.register(blocked);
    coordinator.start();
    coordinator.observe(() => true);
    await settle();
    expect(info.commit).not.toHaveBeenCalled();
    expect(blocked.commit).not.toHaveBeenCalled();
  });
});

it('retains a cursor through execution and transfers it without completing earlier actions', async () => {
  const coordinator = new CompletionCoordinator(async () => true);
  const item = step({
    actions: [
      { targetAction: 'button', refTarget: 'Next' },
      { targetAction: 'button', refTarget: 'Save' },
    ],
  });
  coordinator.register(item);
  coordinator.start();
  coordinator.observe(() => true);
  coordinator.update(item.id, { ...item, executing: true });
  coordinator.observe(() => true);
  expect(coordinator.cursor(item.id)).toBe(1);
  const cursors = coordinator.exportCursors();
  coordinator.stop();
  const next = new CompletionCoordinator(async () => true, cursors);
  next.register(item);
  next.start();
  await settle();
  expect(item.commit).not.toHaveBeenCalled();
  next.observe(() => true);
  await settle();
  expect(item.commit).toHaveBeenCalledTimes(1);
  const reopened = new CompletionCoordinator(async () => true);
  reopened.register(item);
  expect(reopened.cursor(item.id)).toBe(0);
});

it('does not bypass blank or partially invalid authored objectives', async () => {
  const coordinator = new CompletionCoordinator(async (conditions) => !conditions.includes('invalid'));
  const blank = step({ id: 'blank', objectives: [''] });
  const mixed = step({ id: 'mixed', objectives: ['has-datasources', 'invalid'] });
  coordinator.register(blank);
  coordinator.register(mixed);
  coordinator.start();
  coordinator.request(blank.id);
  coordinator.request(mixed.id);
  await settle();
  expect(blank.commit).not.toHaveBeenCalled();
  expect(mixed.commit).not.toHaveBeenCalled();
});

it('runs command checks only once per explicit request', async () => {
  const check = jest.fn().mockResolvedValue(false);
  const coordinator = new CompletionCoordinator(check);
  const item = step({ objectives: ['coda-exit-zero:echo hello'] });
  coordinator.register(item);
  coordinator.start();
  coordinator.request(item.id);
  await settle();
  expect(check).toHaveBeenCalledTimes(1);
  coordinator.recheck();
  await settle();
  expect(check).toHaveBeenCalledTimes(1);
  coordinator.retry(item.id);
  await settle();
  expect(check).toHaveBeenCalledTimes(2);
});

it('resets one section without losing another section action cursor', () => {
  const coordinator = new CompletionCoordinator(async () => false);
  const actions = [{ targetAction: 'button' }, { targetAction: 'button' }];
  coordinator.register(step({ id: 'a', sectionId: 'one', actions }));
  coordinator.register(step({ id: 'b', sectionId: 'two', actions }));
  coordinator.start();
  coordinator.observeIndex('a', 0);
  coordinator.observeIndex('b', 0);
  coordinator.resetScope(undefined, 'one');
  expect(coordinator.cursor('a')).toBe(0);
  expect(coordinator.cursor('b')).toBe(1);
});

it('only observes mounted conditional branches and retains their cursor within the session', async () => {
  const coordinator = new CompletionCoordinator(async () => false);
  const item = step({ actions: [{ targetAction: 'button' }, { targetAction: 'button' }] });
  const unmount = coordinator.register(item);
  coordinator.start();
  coordinator.observe(() => true);
  unmount();
  coordinator.observe(() => true);
  await settle();
  expect(item.commit).not.toHaveBeenCalled();
  coordinator.register(item);
  expect(coordinator.cursor(item.id)).toBe(1);
  coordinator.observe(() => true);
  await settle();
  expect(item.commit).toHaveBeenCalledTimes(1);
});

it('bounds concurrent checks across different objectives', async () => {
  let active = 0;
  let maximum = 0;
  const pending: Array<() => void> = [];
  const coordinator = new CompletionCoordinator(
    () =>
      new Promise<boolean>((resolve) => {
        active++;
        maximum = Math.max(maximum, active);
        pending.push(() => {
          active--;
          resolve(false);
        });
      })
  );
  for (let i = 0; i < 8; i++) {
    coordinator.register(step({ id: `${i}`, objectives: [`has-dashboard-named:${i}`] }));
  }
  coordinator.start();
  expect(active).toBe(4);
  pending.splice(0).forEach((finish) => finish());
  await settle();
  expect(active).toBe(4);
  expect(maximum).toBe(4);
  pending.splice(0).forEach((finish) => finish());
  await settle();
  coordinator.stop();
});

it('does not mistake assistance clicks for manual evidence on another step', async () => {
  const coordinator = new CompletionCoordinator(async () => false);
  const executing = step({ id: 'assisted', executing: true });
  const other = step({ id: 'other' });
  coordinator.register(executing);
  coordinator.register(other);
  coordinator.start();
  coordinator.observe(() => true);
  await settle();
  expect(other.commit).not.toHaveBeenCalled();
});

it('waits for persisted progress before recording existing outcomes again', async () => {
  let hydrated!: (completed: boolean) => void;
  const readCompleted = () =>
    new Promise<boolean>((resolve) => {
      hydrated = resolve;
    });
  const check = jest.fn().mockResolvedValue(true);
  const coordinator = new CompletionCoordinator(check);
  const item = step({ objectives: ['has-datasources'], readCompleted });
  coordinator.register(item);
  coordinator.start();
  expect(check).not.toHaveBeenCalled();
  hydrated(true);
  await settle();
  expect(item.commit).not.toHaveBeenCalled();
  coordinator.stop();
});

describe('assisted completion requests', () => {
  it('commits an ungated request at once, even while the run is still executing', () => {
    const coordinator = new CompletionCoordinator(jest.fn());
    const item = step({ id: 'ungated', executing: true });
    coordinator.register(item);
    coordinator.request(item.id);
    expect(item.commit).toHaveBeenCalledWith('manual', 'change');
  });

  it('lets an early request skip verify but never objectives', async () => {
    const coordinator = new CompletionCoordinator(async () => false);
    const verified = step({ id: 'early-verify', verify: ['on-page:/done'] });
    const gated = step({ id: 'early-objective', objectives: ['has-datasources'] });
    coordinator.register(verified);
    coordinator.register(gated);
    coordinator.start();
    coordinator.request(verified.id, 'manual', true);
    coordinator.request(gated.id, 'manual', true);
    await settle();
    expect(verified.commit).toHaveBeenCalledWith('manual', 'change');
    expect(gated.commit).not.toHaveBeenCalled();
    expect(coordinator.waiting(gated.id)).toBe(true);
    coordinator.reset();
    coordinator.stop();
  });

  it('commits through the dormant step when the host unmounted before an ungated request', () => {
    const coordinator = new CompletionCoordinator(jest.fn());
    const item = step({ id: 'unmounted-host' });
    const unregister = coordinator.register(item);
    unregister();
    coordinator.request(item.id);
    coordinator.request(item.id);
    expect(item.commit).toHaveBeenCalledTimes(1);
    expect(item.commit).toHaveBeenCalledWith('manual', 'change');
  });

  it('re-arms a gated request on the successor host, including in another coordinator', async () => {
    let satisfied = false;
    const first = new CompletionCoordinator(async () => satisfied);
    const original = step({ id: 'handed-off', verify: ['on-page:/done'] });
    const unregister = first.register(original);
    first.start();
    first.request(original.id);
    await settle();
    unregister();
    first.stop();

    satisfied = true;
    const second = new CompletionCoordinator(async () => satisfied);
    const successor = step({ id: 'handed-off', verify: ['on-page:/done'] });
    second.start();
    second.register(successor);
    await settle();
    expect(successor.commit).toHaveBeenCalledWith('manual', 'change');
    expect(original.commit).not.toHaveBeenCalled();
    second.stop();
  });

  it('does not re-arm a request that a reset cleared', async () => {
    const coordinator = new CompletionCoordinator(async () => true);
    const item = step({ id: 'reset-request', verify: ['on-page:/done'] });
    const unregister = coordinator.register(item);
    coordinator.request(item.id);
    unregister();
    coordinator.reset(item.id);
    const successor = step({ id: 'reset-request', verify: ['on-page:/done'] });
    coordinator.register(successor);
    coordinator.start();
    await settle();
    expect(successor.commit).not.toHaveBeenCalled();
    coordinator.stop();
  });

  it('reports the first unmet condition while waiting', async () => {
    const coordinator = new CompletionCoordinator(async ([token]) => token === 'has-datasources');
    const item = step({ id: 'unmet', objectives: ['has-datasources', 'on-page:/explore'] });
    coordinator.register(item);
    coordinator.start();
    coordinator.request(item.id);
    await settle();
    expect(coordinator.unmet(item.id)).toBe('on-page:/explore');
    coordinator.reset();
    coordinator.stop();
  });
});

describe('waitForCompletion', () => {
  it('settles false when the waiting step unregisters', async () => {
    const coordinator = new CompletionCoordinator(async () => false);
    const item = step({ id: 'branch-flip', objectives: ['has-datasources'] });
    const unregister = coordinator.register(item);
    coordinator.start();
    const result = coordinator.waitForCompletion(item.id, new AbortController().signal);
    unregister();
    await expect(result).resolves.toBe(false);
    coordinator.reset();
    coordinator.stop();
  });

  it('settles false when the coordinator stops', async () => {
    const coordinator = new CompletionCoordinator(async () => false);
    const item = step({ id: 'stopped', objectives: ['has-datasources'] });
    coordinator.register(item);
    coordinator.start();
    const result = coordinator.waitForCompletion(item.id, new AbortController().signal);
    coordinator.stop();
    await expect(result).resolves.toBe(false);
  });
});

it('lets a request retry after the completion callback throws', () => {
  const coordinator = new CompletionCoordinator(jest.fn());
  const commit = jest
    .fn()
    .mockImplementationOnce(() => {
      throw new Error('parent persistence failed');
    })
    .mockImplementation(() => undefined);
  const item = step({ id: 'retry-commit', commit });
  coordinator.register(item);
  expect(() => coordinator.request(item.id)).toThrow('parent persistence failed');
  coordinator.request(item.id);
  expect(commit).toHaveBeenCalledTimes(2);
  coordinator.request(item.id);
  expect(commit).toHaveBeenCalledTimes(2);
});

it("resets only its own guide's held requests", async () => {
  const first = new CompletionCoordinator(async () => false);
  const held = step({ id: 'guide-b/step', guideKey: 'guide-b', verify: ['on-page:/done'] });
  const unregister = first.register(held);
  first.request(held.id);
  unregister();

  const other = new CompletionCoordinator(async () => true);
  other.register(step({ id: 'guide-a/step', guideKey: 'guide-a' }));
  other.reset();

  const successor = new CompletionCoordinator(async () => true);
  const rearmed = step({ id: 'guide-b/step', guideKey: 'guide-b', verify: ['on-page:/done'] });
  successor.start();
  successor.register(rearmed);
  await settle();
  expect(rearmed.commit).toHaveBeenCalledWith('manual', 'change');
  successor.stop();
});

it("clears every guide's held requests on an all-guides reset", async () => {
  const first = new CompletionCoordinator(async () => false);
  const held = step({ id: 'guide-c/step', guideKey: 'guide-c', verify: ['on-page:/done'] });
  const unregister = first.register(held);
  first.request(held.id);
  unregister();

  const other = new CompletionCoordinator(async () => true);
  other.register(step({ id: 'guide-a/step-2', guideKey: 'guide-a' }));
  other.reset(undefined, 'all');

  const successor = new CompletionCoordinator(async () => true);
  const reopened = step({ id: 'guide-c/step', guideKey: 'guide-c', verify: ['on-page:/done'] });
  successor.start();
  successor.register(reopened);
  await settle();
  expect(reopened.commit).not.toHaveBeenCalled();
  successor.stop();
});

describe('cursor handoff and unobservable actions', () => {
  const twoActions = [
    { targetAction: 'button', refTarget: 'Open' },
    { targetAction: 'button', refTarget: 'Save' },
  ];

  it('never rewinds a live cursor when a less advanced snapshot is restored', () => {
    const coordinator = new CompletionCoordinator(jest.fn());
    const item = step({ id: 'restore-live', actions: twoActions });
    coordinator.register(item);
    coordinator.observeIndex(item.id, 0);
    expect(coordinator.cursor(item.id)).toBe(1);
    coordinator.restore({ [item.id]: 0 });
    expect(coordinator.cursor(item.id)).toBe(1);
  });

  it('keeps the dormant cursor when a lower restored cursor arrives before re-registering', () => {
    const coordinator = new CompletionCoordinator(jest.fn());
    const item = step({ id: 'restore-dormant', actions: twoActions });
    const unregister = coordinator.register(item);
    coordinator.observeIndex(item.id, 0);
    unregister();
    coordinator.restore({ [item.id]: 0 });
    coordinator.register(step({ id: 'restore-dormant', actions: twoActions }));
    expect(coordinator.cursor(item.id)).toBe(1);
  });

  it('skips a popout action so the actions after it can still be observed', async () => {
    const coordinator = new CompletionCoordinator(jest.fn());
    const item = step({
      id: 'popout-then-save',
      actions: [
        { targetAction: 'popout', targetValue: 'floating' },
        { targetAction: 'button', refTarget: 'Save' },
      ],
    });
    coordinator.register(item);
    coordinator.start();
    coordinator.observe((action) => action.refTarget === 'Save');
    await settle();
    expect(item.commit).toHaveBeenCalledWith('observed', 'change');
    coordinator.stop();
  });
});

it("keeps another guide's held request when a same-position step is reset", async () => {
  const left = new CompletionCoordinator(async () => false);
  const held = step({
    id: 'guide-d/step',
    guideKey: 'guide-d',
    sectionId: 'section-1',
    stepId: 'step-1',
    verify: ['on-page:/done'],
  });
  const unregister = left.register(held);
  left.request(held.id);
  unregister();

  const current = new CompletionCoordinator(async () => true);
  current.register(step({ id: 'guide-e/step', guideKey: 'guide-e', sectionId: 'section-1', stepId: 'step-1' }));
  current.resetScope('step-1', 'section-1');

  const reopened = new CompletionCoordinator(async () => true);
  const successor = step({
    id: 'guide-d/step',
    guideKey: 'guide-d',
    sectionId: 'section-1',
    stepId: 'step-1',
    verify: ['on-page:/done'],
  });
  reopened.start();
  reopened.register(successor);
  await settle();
  expect(successor.commit).toHaveBeenCalledWith('manual', 'change');
  reopened.stop();
});

it('does not re-run objective checks for events that record no evidence', async () => {
  const check = jest.fn().mockResolvedValue(false);
  const coordinator = new CompletionCoordinator(check);
  coordinator.register(step({ id: 'quiet-objective', objectives: ['has-datasource:prometheus'] }));
  coordinator.register(step({ id: 'quiet-action' }));
  coordinator.start();
  await settle();
  const checksAfterOpen = check.mock.calls.length;
  for (let i = 0; i < 20; i++) {
    coordinator.observe(() => false);
  }
  await settle();
  expect(check).toHaveBeenCalledTimes(checksAfterOpen);
  coordinator.stop();
});

it('marks only objectives met on their first answered check as a load', async () => {
  let ready = false;
  const coordinator = new CompletionCoordinator(async ([token]) => token === 'has-datasources' || ready);
  const existing = step({ id: 'existing-outcome', objectives: ['has-datasources'] });
  const later = step({ id: 'later-outcome', objectives: ['has-dashboard-named:Example'] });
  coordinator.register(existing);
  coordinator.register(later);
  coordinator.start();
  await settle();
  expect(existing.commit).toHaveBeenCalledWith('objectives', 'load');
  expect(later.commit).not.toHaveBeenCalled();
  ready = true;
  coordinator.recheck();
  await settle();
  expect(later.commit).toHaveBeenCalledWith('objectives', 'change');
  coordinator.stop();
});

it('still records an already-met objective as a load when its first checks gave no answer', async () => {
  let answer: boolean | undefined = undefined;
  const coordinator = new CompletionCoordinator(async () => answer);
  const existing = step({ objectives: ['has-datasources'] });
  coordinator.register(existing);
  coordinator.start();
  await settle();
  coordinator.recheck();
  await settle();
  expect(existing.commit).not.toHaveBeenCalled();
  answer = true;
  coordinator.recheck();
  await settle();
  expect(existing.commit).toHaveBeenCalledWith('objectives', 'load');
  coordinator.stop();
});

it('records an assisted completion as a change even when objectives were never seen unmet', async () => {
  let answer: boolean | undefined = undefined;
  const coordinator = new CompletionCoordinator(async () => answer);
  const assisted = step({ objectives: ['has-datasources'] });
  coordinator.register(assisted);
  coordinator.start();
  await settle();
  coordinator.request(assisted.id);
  answer = true;
  coordinator.recheck();
  await settle();
  expect(assisted.commit).toHaveBeenCalledWith(expect.any(String), 'change');
  coordinator.stop();
});

it('takes a fresh baseline after a reset', async () => {
  let ready = false;
  const coordinator = new CompletionCoordinator(async () => ready);
  const item = step({ objectives: ['has-datasources'] });
  coordinator.register(item);
  coordinator.start();
  await settle();
  ready = true;
  coordinator.recheck();
  await settle();
  expect(item.commit).toHaveBeenLastCalledWith('objectives', 'change');
  coordinator.reset();
  await settle();
  expect(item.commit).toHaveBeenLastCalledWith('objectives', 'load');
  coordinator.stop();
});

it('resets one step without restarting observation or checks for the rest of the guide', async () => {
  const signals: Record<string, AbortSignal> = {};
  const coordinator = new CompletionCoordinator(
    (_conditions, item, signal) =>
      new Promise(() => {
        signals[item.id] = signal;
      })
  );
  const pending = step({ id: 'pending', objectives: ['has-datasources'] });
  const partial = step({
    id: 'partial',
    actions: [
      { targetAction: 'button', refTarget: '#first' },
      { targetAction: 'button', refTarget: '#last' },
    ],
  });
  coordinator.register(pending);
  coordinator.register(partial);
  coordinator.start();
  await settle();
  const generation = coordinator.generation;
  coordinator.observe((action) => action.refTarget === '#first');
  coordinator.reset('partial');
  expect(coordinator.generation).toBe(generation);
  expect(signals.pending!.aborted).toBe(false);
  const seen: number[] = [];
  coordinator.observe((action, since) => {
    seen.push(since);
    return false;
  });
  const epochs = Object.fromEntries(
    coordinator.pendingActions().map(({ id, epoch, cursor }) => [id, { epoch, cursor }])
  );
  expect(epochs.partial).toEqual({ epoch: seen[0], cursor: 0 });
  expect(seen[0]).toBeGreaterThan(0);
  coordinator.stop();
});

describe('a reader action shared by blocks in different sections', () => {
  const save = { targetAction: 'button', refTarget: '#save' };
  const setup = () => {
    const coordinator = new CompletionCoordinator(async () => false);
    const later = step({ id: 'later', sectionId: 'second', order: 5, actions: [save] });
    const opener = step({
      id: 'opener',
      sectionId: 'second',
      order: 4,
      actions: [
        { targetAction: 'button', refTarget: '#open' },
        { targetAction: 'button', refTarget: '#close' },
      ],
    });
    const earlier = step({ id: 'earlier', sectionId: 'first', order: 1, actions: [save] });
    coordinator.register(later);
    coordinator.register(opener);
    coordinator.register(earlier);
    coordinator.start();
    const click = (target: string) => coordinator.observe((action) => action.refTarget === target);
    return { coordinator, later, earlier, click };
  };

  it('credits the earliest block in guide order, whatever order the blocks registered in', async () => {
    const { coordinator, later, earlier, click } = setup();
    click('#save');
    await settle();
    expect(earlier.commit).toHaveBeenCalledWith('observed', 'change');
    expect(later.commit).not.toHaveBeenCalled();
    coordinator.stop();
  });

  it('credits a later section the reader has started instead of the untouched earlier one', async () => {
    const { coordinator, later, earlier, click } = setup();
    click('#open');
    expect(coordinator.pendingActions().map(({ id }) => id)).toEqual(['opener', 'later', 'earlier']);
    click('#save');
    await settle();
    expect(later.commit).toHaveBeenCalledWith('observed', 'change');
    expect(earlier.commit).not.toHaveBeenCalled();
    coordinator.stop();
  });

  it('returns to guide order once each step of the started section is reset', async () => {
    const { coordinator, later, earlier, click } = setup();
    click('#open');
    coordinator.reset('opener');
    coordinator.reset('later');
    click('#save');
    await settle();
    expect(earlier.commit).toHaveBeenCalledWith('observed', 'change');
    expect(later.commit).not.toHaveBeenCalled();
    coordinator.stop();
  });

  it('keeps a section started by a skip across a surface handoff', async () => {
    const before = new CompletionCoordinator(async () => false);
    const skipped = step({ id: 'skipped', sectionId: 'second', order: 4, actions: [save] });
    before.register(skipped);
    before.start();
    before.request('skipped', 'skipped');
    const started = before.exportStarted();
    before.stop();
    expect(started).toEqual(['skipped']);

    const after = new CompletionCoordinator(async () => false);
    after.restore({}, started);
    const later = step({ id: 'later', sectionId: 'second', order: 5, actions: [save] });
    const earlier = step({ id: 'earlier', sectionId: 'first', order: 1, actions: [save] });
    after.register({ ...skipped, completed: true });
    after.register(later);
    after.register(earlier);
    after.start();
    after.observe((action) => action.refTarget === '#save');
    await settle();
    expect(later.commit).toHaveBeenCalledWith('observed', 'change');
    expect(earlier.commit).not.toHaveBeenCalled();
    after.stop();
  });

  it('keeps a section started by a skip on an unmounted step', async () => {
    const coordinator = new CompletionCoordinator(async () => false);
    const skipped = step({ id: 'skipped', sectionId: 'second', order: 4, actions: [save] });
    const later = step({ id: 'later', sectionId: 'second', order: 5, actions: [save] });
    const earlier = step({ id: 'earlier', sectionId: 'first', order: 1, actions: [save] });
    const unmount = coordinator.register(skipped);
    coordinator.register(later);
    coordinator.register(earlier);
    coordinator.start();
    unmount();
    coordinator.request('skipped', 'skipped');
    expect(skipped.commit).toHaveBeenCalledWith('skipped', 'change');
    expect(coordinator.exportStarted()).toEqual(['skipped']);
    coordinator.observe((action) => action.refTarget === '#save');
    await settle();
    expect(later.commit).toHaveBeenCalledWith('observed', 'change');
    expect(earlier.commit).not.toHaveBeenCalled();
    coordinator.stop();
  });

  it('returns to guide order once the started section is reset', async () => {
    const { coordinator, later, earlier, click } = setup();
    click('#open');
    coordinator.resetScope(undefined, 'second');
    click('#save');
    await settle();
    expect(earlier.commit).toHaveBeenCalledWith('observed', 'change');
    expect(later.commit).not.toHaveBeenCalled();
    coordinator.stop();
  });
});
