import { expandParentNavigationHandler } from './fix-handlers/expand-parent-navigation';
import { locationHandler } from './fix-handlers/location';
import { expandOptionsGroupHandler } from './fix-handlers/expand-options-group';
import { navigationHandler } from './fix-handlers/navigation';
import type { FixContext } from './fix-handlers/types';

function makeNavManager(overrides: Partial<FixContext['navigationManager']> = {} as any) {
  return {
    expandParentNavigationSection: jest.fn().mockResolvedValue(true),
    fixLocationRequirement: jest.fn().mockResolvedValue(undefined),
    fixNavigationRequirements: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeContext(overrides: Partial<FixContext> = {}): FixContext {
  return {
    stepId: 'test-step',
    navigationManager: makeNavManager() as any,
    fixNavigationRequirements: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('expandParentNavigationHandler', () => {
  it('matches expand-parent-navigation fixType with targetHref and navigationManager', () => {
    const ctx = makeContext({ fixType: 'expand-parent-navigation', targetHref: '/connections' });
    expect(expandParentNavigationHandler.canHandle(ctx)).toBe(true);
  });

  it('does not match when targetHref is missing', () => {
    const ctx = makeContext({ fixType: 'expand-parent-navigation', targetHref: undefined });
    expect(expandParentNavigationHandler.canHandle(ctx)).toBe(false);
  });

  it('does not match when navigationManager is null', () => {
    const ctx = makeContext({
      fixType: 'expand-parent-navigation',
      targetHref: '/connections',
      navigationManager: null,
    });
    expect(expandParentNavigationHandler.canHandle(ctx)).toBe(false);
  });

  it('calls expandParentNavigationSection with the targetHref', async () => {
    const navMgr = makeNavManager();
    const ctx = makeContext({
      fixType: 'expand-parent-navigation',
      targetHref: '/connections/datasources',
      navigationManager: navMgr as any,
    });

    const result = await expandParentNavigationHandler.execute(ctx);

    expect(result).toEqual({ ok: true });
    expect(navMgr.expandParentNavigationSection).toHaveBeenCalledWith('/connections/datasources');
  });

  it('returns ok:false when the underlying call resolves to false', async () => {
    const navMgr = makeNavManager({ expandParentNavigationSection: jest.fn().mockResolvedValue(false) } as any);
    const ctx = makeContext({
      fixType: 'expand-parent-navigation',
      targetHref: '/connections',
      navigationManager: navMgr as any,
    });

    const result = await expandParentNavigationHandler.execute(ctx);

    expect(result).toEqual({ ok: false, error: 'Failed to expand parent navigation section' });
  });
});

describe('locationHandler', () => {
  it('matches location fixType with targetHref and navigationManager', () => {
    const ctx = makeContext({ fixType: 'location', targetHref: '/explore' });
    expect(locationHandler.canHandle(ctx)).toBe(true);
  });

  it('calls fixLocationRequirement with the targetHref', async () => {
    const navMgr = makeNavManager();
    const ctx = makeContext({
      fixType: 'location',
      targetHref: '/explore',
      navigationManager: navMgr as any,
    });

    const result = await locationHandler.execute(ctx);

    expect(result).toEqual({ ok: true });
    expect(navMgr.fixLocationRequirement).toHaveBeenCalledWith('/explore');
  });
});

describe('expandOptionsGroupHandler', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('matches expand-options-group fixType regardless of targetHref', () => {
    const ctx = makeContext({ fixType: 'expand-options-group' });
    expect(expandOptionsGroupHandler.canHandle(ctx)).toBe(true);
  });

  it('clicks every collapsed Options group toggle and skips already-open ones', async () => {
    document.body.innerHTML = `
      <button data-testid="data-testid Options group A" aria-expanded="false">A</button>
      <button data-testid="data-testid Options group B" aria-expanded="false">B</button>
      <button data-testid="data-testid Options group C" aria-expanded="true">C</button>
    `;
    const a = document.querySelector('[data-testid="data-testid Options group A"]') as HTMLButtonElement;
    const b = document.querySelector('[data-testid="data-testid Options group B"]') as HTMLButtonElement;
    const c = document.querySelector('[data-testid="data-testid Options group C"]') as HTMLButtonElement;
    const clickA = jest.spyOn(a, 'click');
    const clickB = jest.spyOn(b, 'click');
    const clickC = jest.spyOn(c, 'click');

    const result = await expandOptionsGroupHandler.execute(makeContext({ fixType: 'expand-options-group' }));

    expect(result).toEqual({ ok: true });
    expect(clickA).toHaveBeenCalledTimes(1);
    expect(clickB).toHaveBeenCalledTimes(1);
    expect(clickC).not.toHaveBeenCalled();
  });
});

describe('navigationHandler', () => {
  it('matches when fixType is navigation', () => {
    const ctx = makeContext({ fixType: 'navigation' });
    expect(navigationHandler.canHandle(ctx)).toBe(true);
  });

  it('matches when requirements include navmenu-open even without explicit fixType (legacy fallback)', () => {
    const ctx = makeContext({ fixType: undefined, requirements: 'navmenu-open' });
    expect(navigationHandler.canHandle(ctx)).toBe(true);
  });

  it('matches navmenu-open in a comma-separated requirements string', () => {
    const ctx = makeContext({ fixType: undefined, requirements: 'navmenu-open, exists-reftarget' });
    expect(navigationHandler.canHandle(ctx)).toBe(true);
  });

  it('does not match when neither fixType nor requirements signal navigation', () => {
    const ctx = makeContext({ fixType: 'has-datasource', requirements: 'has-datasource:prom' });
    expect(navigationHandler.canHandle(ctx)).toBe(false);
  });

  it('calls fixNavigationRequirements from the context', async () => {
    const fixNav = jest.fn().mockResolvedValue(undefined);
    const ctx = makeContext({ fixType: 'navigation', fixNavigationRequirements: fixNav });

    const result = await navigationHandler.execute(ctx);

    expect(result).toEqual({ ok: true });
    expect(fixNav).toHaveBeenCalledTimes(1);
  });
});
