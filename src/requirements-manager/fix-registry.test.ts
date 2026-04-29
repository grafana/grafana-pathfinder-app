import { dispatchFix } from './fix-registry';
import type { FixContext } from './fix-handlers';

function makeContext(overrides: Partial<FixContext> = {}): FixContext {
  return {
    stepId: 'test-step',
    navigationManager: {
      expandParentNavigationSection: jest.fn().mockResolvedValue(true),
      fixLocationRequirement: jest.fn().mockResolvedValue(undefined),
      fixNavigationRequirements: jest.fn().mockResolvedValue(undefined),
    },
    fixNavigationRequirements: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('dispatchFix', () => {
  it('runs expand-parent-navigation handler for that fixType', async () => {
    const ctx = makeContext({
      fixType: 'expand-parent-navigation',
      targetHref: '/connections/foo',
    });
    const result = await dispatchFix(ctx);

    expect(result).toEqual({ ok: true });
    expect(ctx.navigationManager?.expandParentNavigationSection).toHaveBeenCalledWith('/connections/foo');
    expect(ctx.navigationManager?.fixLocationRequirement).not.toHaveBeenCalled();
  });

  it('runs location handler for fixType=location', async () => {
    const ctx = makeContext({ fixType: 'location', targetHref: '/explore' });
    const result = await dispatchFix(ctx);

    expect(result).toEqual({ ok: true });
    expect(ctx.navigationManager?.fixLocationRequirement).toHaveBeenCalledWith('/explore');
  });

  it('runs navigation handler when fixType=navigation', async () => {
    const ctx = makeContext({ fixType: 'navigation' });
    const result = await dispatchFix(ctx);

    expect(result).toEqual({ ok: true });
    expect(ctx.fixNavigationRequirements).toHaveBeenCalledTimes(1);
  });

  it('runs navigation handler via legacy fallback (navmenu-open in requirements, no explicit fixType)', async () => {
    const ctx = makeContext({ fixType: undefined, requirements: 'navmenu-open' });
    const result = await dispatchFix(ctx);

    expect(result).toEqual({ ok: true });
    expect(ctx.fixNavigationRequirements).toHaveBeenCalledTimes(1);
  });

  it('prefers location over navigation when both could match', async () => {
    // location must be tried before navigation because the array is ordered
    // most-specific first.
    const ctx = makeContext({
      fixType: 'location',
      targetHref: '/explore',
      requirements: 'navmenu-open, on-page:/explore',
    });
    const result = await dispatchFix(ctx);

    expect(result).toEqual({ ok: true });
    expect(ctx.navigationManager?.fixLocationRequirement).toHaveBeenCalledWith('/explore');
    expect(ctx.fixNavigationRequirements).not.toHaveBeenCalled();
  });

  it('returns ok:false when no handler matches', async () => {
    const ctx = makeContext({ fixType: 'lazy-scroll' });
    const result = await dispatchFix(ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('No fix handler matched');
    }
  });

  it('returns ok:false when navigationManager is null and the chosen handler needs it', async () => {
    const ctx = makeContext({
      fixType: 'expand-parent-navigation',
      targetHref: '/connections',
      navigationManager: null,
    });
    const result = await dispatchFix(ctx);

    expect(result.ok).toBe(false);
  });
});
