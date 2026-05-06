/**
 * Tests for the requirements suggester.
 *
 * Two flavours:
 * - `suggestDefaultRequirements` (silent-injection) — just the existing
 *   action-and-reftarget rules.
 * - `suggestRequirementsFromContext` (Phase 3 context-aware) — richer
 *   rules driven by structural context (first-step, inside-multistep,
 *   currentPath).
 */

import {
  suggestDefaultRequirements,
  suggestRequirementsFromContext,
  mergeRequirements,
} from './requirements-suggester';

const NAV_MENU_REFTARGET = 'a[data-testid="data-testid Nav menu item"][href="/explore"]';

describe('suggestDefaultRequirements', () => {
  it('suggests exists-reftarget for highlight actions', () => {
    expect(suggestDefaultRequirements('highlight', 'button')).toEqual(['exists-reftarget']);
  });

  it('does not suggest exists-reftarget for non-highlight actions', () => {
    expect(suggestDefaultRequirements('button', 'button')).toEqual([]);
    expect(suggestDefaultRequirements('formfill', 'input')).toEqual([]);
  });

  it('suggests navmenu-open when the reftarget targets a nav menu item', () => {
    expect(suggestDefaultRequirements('highlight', NAV_MENU_REFTARGET)).toEqual(['exists-reftarget', 'navmenu-open']);
  });

  it('combines both rules when both apply', () => {
    expect(suggestDefaultRequirements('highlight', 'navigation mega-menu .item')).toEqual([
      'exists-reftarget',
      'navmenu-open',
    ]);
  });
});

describe('suggestRequirementsFromContext', () => {
  const baseContext = { isFirstStepInGuide: false, isInsideMultistep: false, currentPath: '/explore' };

  it('inherits the silent-injection suggestions', () => {
    const result = suggestRequirementsFromContext('highlight', 'button', baseContext);
    expect(result).toContain('exists-reftarget');
  });

  it('suggests on-page: for the first step of a guide pointing into a page area', () => {
    const result = suggestRequirementsFromContext('highlight', 'button', { ...baseContext, isFirstStepInGuide: true });
    expect(result).toContain('on-page:/explore');
  });

  it('suggests on-page: for any formfill regardless of position', () => {
    const result = suggestRequirementsFromContext('formfill', 'input', baseContext);
    expect(result).toContain('on-page:/explore');
  });

  it('does not suggest on-page: when currentPath is empty or root', () => {
    expect(
      suggestRequirementsFromContext('highlight', 'button', {
        ...baseContext,
        isFirstStepInGuide: true,
        currentPath: '/',
      })
    ).not.toContain('on-page:/');
    expect(
      suggestRequirementsFromContext('highlight', 'button', {
        ...baseContext,
        isFirstStepInGuide: true,
        currentPath: undefined,
      })
    ).not.toContain('on-page:');
  });

  it('does not suggest on-page: for `navigate` actions (the action sets its own location)', () => {
    const result = suggestRequirementsFromContext('navigate', '/somewhere', {
      ...baseContext,
      isFirstStepInGuide: true,
    });
    expect(result.some((r) => r.startsWith('on-page:'))).toBe(false);
  });

  it('skips on-page: suggestions for steps inside a multistep', () => {
    const result = suggestRequirementsFromContext('formfill', 'input', { ...baseContext, isInsideMultistep: true });
    expect(result.some((r) => r.startsWith('on-page:'))).toBe(false);
  });

  it('suggests exists-reftarget for nav-menu reftargets even when the action is not `highlight`', () => {
    const result = suggestRequirementsFromContext('button', NAV_MENU_REFTARGET, baseContext);
    expect(result).toContain('exists-reftarget');
    expect(result).toContain('navmenu-open');
  });

  it('returns no duplicates even when multiple rules add the same token', () => {
    const result = suggestRequirementsFromContext('highlight', NAV_MENU_REFTARGET, {
      ...baseContext,
      isFirstStepInGuide: true,
    });
    const counts = result.reduce<Record<string, number>>((acc, r) => {
      acc[r] = (acc[r] ?? 0) + 1;
      return acc;
    }, {});
    expect(Object.values(counts).every((c) => c === 1)).toBe(true);
  });
});

describe('mergeRequirements', () => {
  it('appends new tokens to a comma-separated list', () => {
    expect(mergeRequirements('exists-reftarget', ['navmenu-open'])).toBe('exists-reftarget, navmenu-open');
  });

  it('skips duplicates', () => {
    expect(mergeRequirements('exists-reftarget, navmenu-open', ['navmenu-open'])).toBe(
      'exists-reftarget, navmenu-open'
    );
  });

  it('returns the original string unchanged when nothing new applies', () => {
    expect(mergeRequirements('exists-reftarget', [])).toBe('exists-reftarget');
  });
});
