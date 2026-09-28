import { resolvePathfinderAvailability } from './pathfinder-enablement';

it.each([true, false])(
  'remote disable wins over tenant preference %s without reading settings',
  async (pathfinderEnabled) => {
    const read = jest.fn().mockResolvedValue({ pathfinderEnabled });
    expect(await resolvePathfinderAvailability(false, read)).toBe('disabled');
    expect(read).not.toHaveBeenCalled();
  }
);

it.each([
  [true, 'enabled'],
  [false, 'disabled'],
  [undefined, 'enabled'],
])('remote enable respects tenant preference %s', async (pathfinderEnabled, expected) => {
  expect(await resolvePathfinderAvailability(true, async () => ({ pathfinderEnabled }))).toBe(expected);
});

it('defaults to enabled on unsuccessful reads', async () => {
  expect(await resolvePathfinderAvailability(true, async () => undefined)).toBe('enabled');
  expect(
    await resolvePathfinderAvailability(true, async () => {
      throw new Error('offline');
    })
  ).toBe('enabled');
});

it('bounds a hung read to three seconds and never changes its decision after late resolution', async () => {
  jest.useFakeTimers();
  try {
    let finish!: (settings: { pathfinderEnabled: boolean }) => void;
    const read = new Promise<{ pathfinderEnabled: boolean }>((resolve) => {
      finish = resolve;
    });
    const resolved = jest.fn();
    const availability = resolvePathfinderAvailability(true, () => read).then(resolved);
    await jest.advanceTimersByTimeAsync(2_999);
    expect(resolved).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    await availability;
    expect(resolved).toHaveBeenCalledWith('enabled');
    finish({ pathfinderEnabled: false });
    await Promise.resolve();
    expect(resolved).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});

it.each([403, 503])('keeps Pathfinder enabled when settings return HTTP %s', async (status) => {
  expect(
    await resolvePathfinderAvailability(true, async () => {
      throw { status };
    })
  ).toBe('enabled');
});
