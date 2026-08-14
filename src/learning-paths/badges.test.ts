import { getBadgeForPath } from './badges';

describe('getBadgeForPath', () => {
  it('finds the badge whose path-completed trigger matches the given pathId', () => {
    const badge = getBadgeForPath('linux-server-integration');
    expect(badge?.id).toBe('penguin-wrangler');
  });

  it('returns undefined for a pathId with no matching badge', () => {
    expect(getBadgeForPath('core-grafana-concepts-lj')).toBeUndefined();
  });

  it('ignores badges with a non-path-completed trigger', () => {
    // 'first-steps' is a real badge id but its trigger is 'guide-completed',
    // not 'path-completed' — must not match by id, only by trigger.pathId.
    expect(getBadgeForPath('first-steps')).toBeUndefined();
  });
});
