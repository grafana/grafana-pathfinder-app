/**
 * One test per derivation rule in `deriveManifest`, plus the two invariants that
 * make the whole thing safe: the merge never destroys an inherited path, and the
 * editor never introduces a manifest key the InteractiveGuide CRD would prune.
 */

import { summarizeGuideBlocks } from '../../../lib/guide-stats';
import type { JsonBlock, JsonGuide } from '../types';

import { deriveManifest } from './derive-manifest';

/**
 * Top-level `spec.manifest` keys the InteractiveGuide CRD declares. Hand
 * transcription of `#Manifest` in grafana-pathfinder-backend's
 * `kinds/interactiveguide.cue`, which lives in another repo and cannot be read
 * from here.
 *
 * An undeclared key is not rejected — the API server prunes it, returns 201, and
 * reports the loss only in a `Warning:` header that `getBackendSrv()` never
 * surfaces. So a key this function starts writing that is missing from this set
 * is silent data loss on every save, which is why the invariant below is a test
 * rather than a comment.
 */
const CRD_MANIFEST_KEYS = new Set([
  'type',
  'repository',
  'description',
  'milestones',
  'author',
  'category',
  'depends',
  'additionalFields',
]);

function guide(blocks: JsonBlock[], overrides: Partial<JsonGuide> = {}): JsonGuide {
  return { id: 'my-guide', title: 'My guide', blocks, ...overrides } as JsonGuide;
}

const markdown = (content = 'hello'): JsonBlock => ({ type: 'markdown', content }) as unknown as JsonBlock;

const highlight = (requirements?: string[]): JsonBlock =>
  ({
    type: 'interactive',
    action: 'highlight',
    reftarget: 'a[href="/dashboards"]',
    content: 'Click it',
    ...(requirements ? { requirements } : {}),
  }) as unknown as JsonBlock;

describe('deriveManifest — owned fields', () => {
  it('gives a manifest-less guide a guide-typed, app-platform manifest', () => {
    const result = deriveManifest(guide([markdown()]));

    expect(result.type).toBe('guide');
    expect(result.repository).toBe('app-platform');
  });

  // Rewriting an inherited repository would break the byte-identical replay
  // invariant for a no-op save, and buys nothing: both read paths force
  // `app-platform` for an App Platform resource regardless of what is stored.
  it('leaves an inherited repository alone rather than rewriting it', () => {
    const result = deriveManifest(guide([markdown()]), { type: 'guide', repository: 'interactive-tutorials' });

    expect(result.repository).toBe('interactive-tutorials');
  });

  it('stamps repository when the inherited manifest carries an empty one', () => {
    const result = deriveManifest(guide([markdown()]), { type: 'guide', repository: '' });

    expect(result.repository).toBe('app-platform');
  });

  it('skips the stats stamp for an unrecognised type rather than stamping a wrong denominator', () => {
    const result = deriveManifest(guide([markdown(), highlight()]), { type: 'learning-journey' });

    expect(result.type).toBe('learning-journey');
    expect(result.additionalFields).toBeUndefined();
  });

  it('stamps stats matching the canonical block-count computation', () => {
    const blocks = [markdown(), highlight(), markdown('trailing prose')];

    const result = deriveManifest(guide(blocks));

    const additional = result.additionalFields as Record<string, unknown>;
    expect(additional.stats).toEqual(summarizeGuideBlocks(blocks));
  });

  it('counts a section container as its contents and not itself', () => {
    const section = {
      type: 'section',
      title: 'Setup',
      blocks: [markdown(), highlight()],
    } as unknown as JsonBlock;

    const result = deriveManifest(guide([section]));

    const stats = (result.additionalFields as Record<string, unknown>).stats as Record<string, number>;
    expect(stats.blockCount).toBe(2);
    expect(stats.sectionCount).toBe(1);
  });

  it('writes stats under additionalFields, never at the manifest top level', () => {
    const result = deriveManifest(guide([markdown()]));

    expect(result.stats).toBeUndefined();
    expect((result.additionalFields as Record<string, unknown>).stats).toBeDefined();
  });
});

describe('deriveManifest — never overwrites an inherited path', () => {
  it('keeps an inherited path type instead of forcing guide', () => {
    const result = deriveManifest(guide([markdown()]), { type: 'path', milestones: ['m1', 'm2'] });

    expect(result.type).toBe('path');
  });

  it('keeps an inherited journey type instead of forcing guide', () => {
    const result = deriveManifest(guide([markdown()]), { type: 'journey', milestones: ['m1'] });

    expect(result.type).toBe('journey');
  });

  it('carries inherited milestones through unchanged', () => {
    const milestones = ['alerting-intro', 'alerting-rules'];

    const result = deriveManifest(guide([markdown()]), { type: 'path', milestones });

    expect(result.milestones).toEqual(milestones);
  });

  it('skips the stats stamp for a path, whose rollup it cannot compute', () => {
    const result = deriveManifest(guide([markdown(), highlight()]), { type: 'path', milestones: ['m1'] });

    expect(result.additionalFields).toBeUndefined();
  });

  it('skips the stats stamp for a journey', () => {
    const result = deriveManifest(guide([markdown(), highlight()]), { type: 'journey', milestones: ['m1'] });

    expect(result.additionalFields).toBeUndefined();
  });

  it('leaves an inherited path rollup stamp alone rather than replacing it with cover-page stats', () => {
    const rollup = {
      version: 1,
      blockCount: 42,
      sectionCount: 3,
      completableBlockCount: 20,
      finalCompletablePosition: 40,
    };

    const result = deriveManifest(guide([markdown(), highlight()]), {
      type: 'path',
      milestones: ['m1'],
      additionalFields: { stats: rollup },
    });

    expect((result.additionalFields as Record<string, unknown>).stats).toEqual(rollup);
  });

  it('treats an empty-string inherited type as absent and derives guide', () => {
    const result = deriveManifest(guide([markdown()]), { type: '' });

    expect(result.type).toBe('guide');
  });
});

describe('deriveManifest — inherited passthrough', () => {
  it('carries every inherited field it does not own through byte-identical', () => {
    const inherited = {
      type: 'guide',
      description: 'Authored by the upload script',
      category: 'alerting',
      author: { name: 'Enablement', team: 'Docs' },
      depends: [['other-guide']],
    };

    const result = deriveManifest(guide([markdown()]), inherited);

    expect(result.description).toBe(inherited.description);
    expect(result.category).toBe(inherited.category);
    expect(result.author).toEqual(inherited.author);
    expect(result.depends).toEqual(inherited.depends);
  });

  it('does not mutate the inherited manifest it was given', () => {
    const inherited = { type: 'path', milestones: ['m1'], additionalFields: { stats: { version: 1 } } };
    const snapshot = JSON.parse(JSON.stringify(inherited));

    deriveManifest(guide([markdown(), highlight()]), inherited);

    expect(inherited).toEqual(snapshot);
  });

  it('keeps unrelated additionalFields keys alongside a freshly derived stats stamp', () => {
    const result = deriveManifest(guide([markdown()]), {
      type: 'guide',
      additionalFields: { recommends: ['other-guide'], language: 'en' },
    });

    const additional = result.additionalFields as Record<string, unknown>;
    expect(additional.recommends).toEqual(['other-guide']);
    expect(additional.language).toBe('en');
    expect(additional.stats).toBeDefined();
  });

  it('replaces a stale inherited stats stamp for a plain guide', () => {
    const blocks = [markdown(), highlight()];

    const result = deriveManifest(guide(blocks), {
      type: 'guide',
      additionalFields: { stats: { version: 1, blockCount: 999 } },
    });

    const additional = result.additionalFields as Record<string, unknown>;
    expect(additional.stats).toEqual(summarizeGuideBlocks(blocks));
  });

  it('tolerates a non-object inherited additionalFields without throwing', () => {
    const result = deriveManifest(guide([markdown()]), { type: 'guide', additionalFields: 'nonsense' });

    expect((result.additionalFields as Record<string, unknown>).stats).toBeDefined();
  });
});

describe('deriveManifest — startingLocation', () => {
  it('derives it from the first root block that declares on-page', () => {
    const result = deriveManifest(guide([markdown(), highlight(['on-page:/dashboards'])]));

    expect((result.additionalFields as Record<string, unknown>).startingLocation).toBe('/dashboards');
  });

  it('takes the first declaration in document order when several blocks declare one', () => {
    const result = deriveManifest(guide([highlight(['on-page:/explore']), highlight(['on-page:/dashboards'])]));

    expect((result.additionalFields as Record<string, unknown>).startingLocation).toBe('/explore');
  });

  it('derives it from a step requirement inside a multistep', () => {
    const multistep = {
      type: 'multistep',
      content: 'Do these',
      steps: [
        { action: 'highlight', reftarget: 'a', requirements: ['on-page:/alerting/list'] },
        { action: 'button', reftarget: 'b' },
      ],
    } as unknown as JsonBlock;

    const result = deriveManifest(guide([multistep]));

    expect((result.additionalFields as Record<string, unknown>).startingLocation).toBe('/alerting/list');
  });

  it('descends into a section to find the declaration', () => {
    const section = {
      type: 'section',
      title: 'Setup',
      blocks: [highlight(['on-page:/connections'])],
    } as unknown as JsonBlock;

    const result = deriveManifest(guide([section]));

    expect((result.additionalFields as Record<string, unknown>).startingLocation).toBe('/connections');
  });

  // A `navigate` action is where the guide TAKES the reader, not where it expects
  // them to be. A self-navigating guide needs no alignment prompt, so inferring a
  // starting location from it would produce a prompt that is actively wrong.
  it('does not infer a starting location from a navigate action', () => {
    const navigate = {
      type: 'interactive',
      action: 'navigate',
      reftarget: '/dashboards/new',
      content: 'Go there',
    } as unknown as JsonBlock;

    const result = deriveManifest(guide([navigate]));

    expect((result.additionalFields as Record<string, unknown>).startingLocation).toBeUndefined();
  });

  // The branches of a conditional are mutually exclusive, so neither speaks for
  // the guide as a whole.
  it('does not infer a starting location from inside a conditional branch', () => {
    const conditional = {
      type: 'conditional',
      conditions: ['is-admin'],
      whenTrue: [highlight(['on-page:/admin'])],
      whenFalse: [highlight(['on-page:/home'])],
    } as unknown as JsonBlock;

    const result = deriveManifest(guide([conditional]));

    expect((result.additionalFields as Record<string, unknown>).startingLocation).toBeUndefined();
  });

  it('ignores a relative on-page: value rather than stamping a non-absolute path', () => {
    const result = deriveManifest(guide([highlight(['on-page:dashboards'])]));

    expect((result.additionalFields as Record<string, unknown>).startingLocation).toBeUndefined();
  });

  it('keeps scanning past a relative on-page: and stamps a later absolute one', () => {
    const result = deriveManifest(guide([highlight(['on-page:dashboards']), highlight(['on-page:/alerting/list'])]));

    expect((result.additionalFields as Record<string, unknown>).startingLocation).toBe('/alerting/list');
  });

  it('ignores a bare on-page: requirement with no path', () => {
    const result = deriveManifest(guide([highlight(['on-page:'])]));

    expect((result.additionalFields as Record<string, unknown>).startingLocation).toBeUndefined();
  });

  // `isValidRequirement` accepts `on-page:` on its prefix alone and the parser
  // joins the requirements array with `,`, so a single entry can pack several
  // checks. The joined string is not a route: `confirmAlignment` would push it
  // verbatim at a path that does not exist.
  it('takes only the leading token of a comma-packed on-page requirement', () => {
    const result = deriveManifest(guide([highlight(['on-page:/explore, navmenu-open'])]));

    expect((result.additionalFields as Record<string, unknown>).startingLocation).toBe('/explore');
  });

  it('takes only the leading token of a comma-packed on-page STEP requirement', () => {
    const multistep = {
      type: 'multistep',
      content: 'Do these',
      steps: [{ action: 'highlight', reftarget: 'a', requirements: ['on-page:/alerting/list, navmenu-open'] }],
    } as unknown as JsonBlock;

    const result = deriveManifest(guide([multistep]));

    expect((result.additionalFields as Record<string, unknown>).startingLocation).toBe('/alerting/list');
  });

  it('ignores an on-page whose leading token is not a clean path, and keeps scanning', () => {
    const result = deriveManifest(guide([highlight(['on-page:/explore extra']), highlight(['on-page:/dashboards'])]));

    expect((result.additionalFields as Record<string, unknown>).startingLocation).toBe('/dashboards');
  });

  it('ignores a comma-packed on-page whose leading token is relative', () => {
    const result = deriveManifest(guide([highlight(['on-page:dashboards, navmenu-open'])]));

    expect((result.additionalFields as Record<string, unknown>).startingLocation).toBeUndefined();
  });

  it('ignores non-on-page requirements', () => {
    const result = deriveManifest(guide([highlight(['navmenu-open', 'exists-reftarget'])]));

    expect((result.additionalFields as Record<string, unknown>).startingLocation).toBeUndefined();
  });

  // Written unconditionally: a skipped write would leave a stale value outliving
  // the content that justified it, with no in-product way to clear it.
  it('CLEARS an inherited startingLocation when the content no longer declares one', () => {
    const result = deriveManifest(guide([markdown()]), {
      type: 'guide',
      additionalFields: { startingLocation: '/stale-from-a-removed-requirement' },
    });

    expect((result.additionalFields as Record<string, unknown>).startingLocation).toBeUndefined();
  });

  it('drops additionalFields entirely when clearing leaves nothing behind', () => {
    const result = deriveManifest(guide([markdown()]), {
      type: 'path',
      milestones: ['m1'],
      additionalFields: { startingLocation: '/stale' },
    });

    expect(result.additionalFields).toBeUndefined();
  });

  it('keeps sibling additionalFields keys when it clears startingLocation', () => {
    const result = deriveManifest(guide([markdown()]), {
      type: 'path',
      milestones: ['m1'],
      additionalFields: { startingLocation: '/stale', stats: { version: 1, blockCount: 9 } },
    });

    const additional = result.additionalFields as Record<string, unknown>;
    expect(additional.startingLocation).toBeUndefined();
    expect(additional.stats).toEqual({ version: 1, blockCount: 9 });
  });

  it('updates an inherited startingLocation when the content now declares a different one', () => {
    const result = deriveManifest(guide([highlight(['on-page:/explore'])]), {
      type: 'guide',
      additionalFields: { startingLocation: '/stale' },
    });

    expect((result.additionalFields as Record<string, unknown>).startingLocation).toBe('/explore');
  });

  it('derives one for a path cover page even though stats are skipped', () => {
    const result = deriveManifest(guide([highlight(['on-page:/alerting'])]), {
      type: 'path',
      milestones: ['m1'],
    });

    const additional = result.additionalFields as Record<string, unknown>;
    expect(additional.startingLocation).toBe('/alerting');
    expect(additional.stats).toBeUndefined();
  });
});

describe('deriveManifest — startingLocation stops at navigation', () => {
  const navigate = (reftarget = '/dashboards/new'): JsonBlock =>
    ({ type: 'interactive', action: 'navigate', reftarget, content: 'Go there' }) as unknown as JsonBlock;

  const formfill = (requirements?: string[]): JsonBlock =>
    ({
      type: 'interactive',
      action: 'formfill',
      reftarget: 'input[name=q]',
      targetvalue: 'x',
      content: 'Type it',
      ...(requirements ? { requirements } : {}),
    }) as unknown as JsonBlock;

  // The whole point of the navigate exclusion: the page after a navigation is
  // where the guide TOOK the reader, so stamping it prompts them to go somewhere
  // the guide was about to send them anyway.
  it('ignores an on-page that appears after a navigate block', () => {
    const result = deriveManifest(guide([navigate('/dashboards'), highlight(['on-page:/dashboards'])]));

    expect((result.additionalFields as Record<string, unknown>).startingLocation).toBeUndefined();
  });

  it('still takes an on-page declared before the navigate block', () => {
    const result = deriveManifest(guide([highlight(['on-page:/home']), navigate('/dashboards')]));

    expect((result.additionalFields as Record<string, unknown>).startingLocation).toBe('/home');
  });

  // A requirement carried BY the navigate block is a precondition evaluated
  // before the navigation happens, so it does describe where the guide starts.
  it('takes an on-page carried by the navigate block itself', () => {
    const navigateWithPrecondition = {
      type: 'interactive',
      action: 'navigate',
      reftarget: '/dashboards',
      content: 'Go',
      requirements: ['on-page:/home'],
    } as unknown as JsonBlock;

    const result = deriveManifest(guide([navigateWithPrecondition, highlight(['on-page:/dashboards'])]));

    expect((result.additionalFields as Record<string, unknown>).startingLocation).toBe('/home');
  });

  it('stops at a navigate STEP inside a multistep', () => {
    const multistep = {
      type: 'multistep',
      content: 'Do these',
      steps: [
        { action: 'navigate', reftarget: '/dashboards' },
        { action: 'highlight', reftarget: 'a', requirements: ['on-page:/dashboards'] },
      ],
    } as unknown as JsonBlock;

    const result = deriveManifest(guide([multistep]));

    expect((result.additionalFields as Record<string, unknown>).startingLocation).toBeUndefined();
  });

  it('takes a step on-page declared before the navigate step', () => {
    const multistep = {
      type: 'multistep',
      content: 'Do these',
      steps: [
        { action: 'highlight', reftarget: 'a', requirements: ['on-page:/alerting'] },
        { action: 'navigate', reftarget: '/dashboards' },
      ],
    } as unknown as JsonBlock;

    const result = deriveManifest(guide([multistep]));

    expect((result.additionalFields as Record<string, unknown>).startingLocation).toBe('/alerting');
  });

  it('stops at a navigate nested inside a section, not just at root level', () => {
    const section = {
      type: 'section',
      title: 'Setup',
      blocks: [navigate('/dashboards'), highlight(['on-page:/dashboards'])],
    } as unknown as JsonBlock;

    const result = deriveManifest(guide([section, highlight(['on-page:/explore'])]));

    expect((result.additionalFields as Record<string, unknown>).startingLocation).toBeUndefined();
  });

  // suggestRequirementsFromContext adds on-page:<currentPath> to EVERY formfill
  // regardless of position, so it says a form is page-bound — not where the guide
  // begins.
  it('ignores the on-page the editor auto-suggests on a formfill', () => {
    const result = deriveManifest(guide([formfill(['on-page:/some-form-page'])]));

    expect((result.additionalFields as Record<string, unknown>).startingLocation).toBeUndefined();
  });

  it('ignores a formfill on-page but still takes a later non-formfill one', () => {
    const result = deriveManifest(guide([formfill(['on-page:/form']), highlight(['on-page:/explore'])]));

    expect((result.additionalFields as Record<string, unknown>).startingLocation).toBe('/explore');
  });

  // A guide uploaded with the camelCase `targetAction` alias never passes through
  // `validateGuide` on its way into editor state, so the scan has to read the
  // alias or it sees no navigation and stamps the page the guide navigates TO.
  it('stops at a navigate block written with the targetAction alias', () => {
    const aliased = {
      type: 'interactive',
      targetAction: 'navigate',
      reftarget: '/dashboards',
      content: 'Go there',
    } as unknown as JsonBlock;

    const result = deriveManifest(guide([aliased, highlight(['on-page:/dashboards'])]));

    expect((result.additionalFields as Record<string, unknown>).startingLocation).toBeUndefined();
  });

  it('stops at a navigate STEP written with the targetAction alias', () => {
    const multistep = {
      type: 'multistep',
      content: 'Do these',
      steps: [
        { targetAction: 'navigate', reftarget: '/dashboards' },
        { action: 'highlight', reftarget: 'a', requirements: ['on-page:/dashboards'] },
      ],
    } as unknown as JsonBlock;

    const result = deriveManifest(guide([multistep]));

    expect((result.additionalFields as Record<string, unknown>).startingLocation).toBeUndefined();
  });

  it('ignores the on-page of a formfill written with the targetAction alias', () => {
    const aliased = {
      type: 'interactive',
      targetAction: 'formfill',
      reftarget: 'input[name=q]',
      targetvalue: 'x',
      content: 'Type it',
      requirements: ['on-page:/some-form-page'],
    } as unknown as JsonBlock;

    const result = deriveManifest(guide([aliased]));

    expect((result.additionalFields as Record<string, unknown>).startingLocation).toBeUndefined();
  });

  it('ignores the on-page of a formfill STEP written with the targetAction alias', () => {
    const multistep = {
      type: 'multistep',
      content: 'Do these',
      steps: [
        { targetAction: 'formfill', reftarget: 'input', targetvalue: 'x', requirements: ['on-page:/form'] },
        { action: 'highlight', reftarget: 'a', requirements: ['on-page:/explore'] },
      ],
    } as unknown as JsonBlock;

    const result = deriveManifest(guide([multistep]));

    expect((result.additionalFields as Record<string, unknown>).startingLocation).toBe('/explore');
  });

  it('prefers the canonical action over the alias when a block carries both', () => {
    const both = {
      type: 'interactive',
      action: 'navigate',
      targetAction: 'highlight',
      reftarget: '/dashboards',
      content: 'Go there',
    } as unknown as JsonBlock;

    const result = deriveManifest(guide([both, highlight(['on-page:/dashboards'])]));

    expect((result.additionalFields as Record<string, unknown>).startingLocation).toBeUndefined();
  });

  it('ignores a formfill STEP on-page inside a multistep', () => {
    const multistep = {
      type: 'multistep',
      content: 'Do these',
      steps: [
        { action: 'formfill', reftarget: 'input', targetvalue: 'x', requirements: ['on-page:/form'] },
        { action: 'highlight', reftarget: 'a', requirements: ['on-page:/explore'] },
      ],
    } as unknown as JsonBlock;

    const result = deriveManifest(guide([multistep]));

    expect((result.additionalFields as Record<string, unknown>).startingLocation).toBe('/explore');
  });
});

describe('deriveManifest — CRD key invariant', () => {
  it('introduces no top-level key the CRD would silently prune, from nothing', () => {
    const result = deriveManifest(guide([markdown(), highlight(['on-page:/dashboards'])]));

    expect(Object.keys(result).filter((key) => !CRD_MANIFEST_KEYS.has(key))).toEqual([]);
  });

  it('introduces no top-level key the CRD would silently prune, over an inherited manifest', () => {
    const inherited = { type: 'path', milestones: ['m1'], description: 'A path' };

    const result = deriveManifest(guide([markdown(), highlight(['on-page:/dashboards'])]), inherited);

    const introduced = Object.keys(result).filter((key) => !(key in inherited));
    expect(introduced.filter((key) => !CRD_MANIFEST_KEYS.has(key))).toEqual([]);
  });

  it('produces a manifest the CRD would accept: type is one of its three values', () => {
    expect(['guide', 'path', 'journey']).toContain(deriveManifest(guide([markdown()])).type);
  });
});
