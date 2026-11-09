/**
 * Acceptance test for #2067: analytics values are snake_case, but the domain
 * vocabulary that shares those spellings (deep-link parameters, persisted
 * badge triggers, step-ID seeds) must not change. Shared links already in the
 * wild and stored progress depend on these exact kebab-case values.
 */
import { BADGES } from '../learning-paths/badges';
import { coerceLaunchSource } from '../recovery/launch-sources';
import { deriveStepId } from '../global-state/step-id';
import {
  PATHFINDER_PARAMS,
  buildPathfinderShareUrl,
  parsePathfinderDeepLink,
  shouldOpenAsLearningJourney,
} from './pathfinder-search-params';

describe('domain vocabulary stays kebab-case where it is a URL or storage contract', () => {
  it('keeps the deep-link parameter names', () => {
    expect([...PATHFINDER_PARAMS]).toEqual([
      'doc',
      'type',
      'source',
      'page',
      'kiosk_session',
      'kiosk_name',
      'panelMode',
      'controller',
      'controllerMilestone',
      'controllerTrack',
      'pathfinderKiosk',
      'kioskRulesUrl',
    ]);
  });

  it('parses ?type=learning-journey and ?source=learning-hub unchanged', () => {
    const parsed = parsePathfinderDeepLink('?doc=bundled%3Afoo&type=learning-journey&source=learning-hub');
    expect(parsed.type).toBe('learning-journey');
    expect(parsed.source).toBe('learning-hub');
  });

  it('rejects the snake_case spellings as deep-link values', () => {
    expect(parsePathfinderDeepLink('?type=learning_journey').type).toBeUndefined();
    expect(shouldOpenAsLearningJourney(undefined, 'learning_hub')).toBe(false);
    expect(coerceLaunchSource('learning_hub')).toBeNull();
  });

  it('routes on the kebab-case type and source values', () => {
    expect(shouldOpenAsLearningJourney('learning-journey', undefined)).toBe(true);
    expect(shouldOpenAsLearningJourney(undefined, 'learning-hub')).toBe(true);
    expect(coerceLaunchSource('learning-hub')).toBe('learning-hub');
  });

  it('emits type=learning-journey in share links', () => {
    const url = new URL(
      buildPathfinderShareUrl({
        base: new URL('https://example.com/a'),
        doc: 'pkg:foo',
        panelMode: 'sidebar',
        guideType: 'learning-journey',
      })
    );
    expect(url.searchParams.get('type')).toBe('learning-journey');
  });

  it('keeps persisted badge trigger types', () => {
    const triggerTypes = new Set(BADGES.map((badge) => badge.trigger.type));
    expect(triggerTypes.has('guide-completed')).toBe(true);
    expect(triggerTypes.has('path-completed')).toBe(true);
    expect([...triggerTypes].every((type) => !type.includes('_'))).toBe(true);
  });

  it('keeps step IDs derived from the kebab-case target actions stable', () => {
    const seed = { sectionId: 's', index: 0, refTarget: 'x' };
    expect(deriveStepId({ ...seed, action: 'code-block' })).not.toBe(deriveStepId({ ...seed, action: 'code_block' }));
    expect(deriveStepId({ ...seed, action: 'code-block' })).toMatchInlineSnapshot(`"s-step-g6fh93"`);
  });
});
