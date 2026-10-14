import type { CatalogPackage } from '../types/package-catalog.types';
import { selectCompletionSuggestions } from './completion-suggestions';

const guide = (id: string, patch: Partial<CatalogPackage> = {}): CatalogPackage => ({
  key: `bundled:${id}`,
  id,
  title: id,
  format: 'guide',
  source: 'grafana',
  category: 'dashboards',
  url: `bundled:${id}/content.json`,
  ...patch,
});
const context = { url: 'bundled:current', public: true, inPath: false };

describe('selectCompletionSuggestions', () => {
  it.each(['oss', 'cloud'] as const)('excludes only known incompatible %s platform targets', (platform) => {
    const opposite = platform === 'oss' ? 'cloud' : 'oss';
    const items = [
      guide('current'),
      guide('a-compatible', { targeting: { match: { targetPlatform: platform } } }),
      guide('b-unspecified'),
      guide('incompatible', { targeting: { match: { targetPlatform: opposite } } }),
      guide('incompatible-path', {
        format: 'path',
        curatedPath: {
          id: 'path',
          title: 'Path',
          description: '',
          guides: [],
          badgeId: 'badge',
          targetPlatform: opposite,
        },
      }),
    ];
    expect(selectCompletionSuggestions(items, new Map(), { ...context, platform }).map((item) => item.id)).toEqual([
      'a-compatible',
      'b-unspecified',
    ]);
  });

  it('evaluates nested platform and/or while treating unrelated and unknown constraints as compatible', () => {
    const items = [
      guide('current'),
      guide('a-compatible', {
        targeting: {
          match: {
            and: [{ urlPrefix: '/dashboards' }, { or: [{ targetPlatform: 'cloud' }, { targetPlatform: 'oss' }] }],
          },
        },
      }),
      guide('b-unknown', { targeting: { match: { or: [{ targetPlatform: 'cloud' }, { targetPlatform: 'future' }] } } }),
      guide('c-unknown', {
        targeting: { match: { and: [{ or: [{ targetPlatform: 'cloud' }, { urlPrefix: '/explore' }] }] } },
      }),
      guide('incompatible', {
        targeting: { match: { and: [{ or: [{ targetPlatform: 'cloud' }, { targetPlatform: 'cloud' }] }] } },
      }),
    ];
    expect(
      selectCompletionSuggestions(items, new Map(), { ...context, platform: 'oss' }).map((item) => item.id)
    ).toEqual(['a-compatible', 'b-unknown']);
    expect(
      selectCompletionSuggestions([items[0]!, items[3]!, items[4]!], new Map(), { ...context, platform: 'oss' }).map(
        (item) => item.id
      )
    ).toEqual(['c-unknown']);
  });

  it('excludes current bundled aliases, private content and completed guides or paths', () => {
    const items = [
      guide('current'),
      guide('private', { source: 'organization' }),
      guide('done'),
      guide('done-path', { format: 'path' }),
      guide('next'),
    ];
    const progress = new Map([
      ['bundled:done', { percent: 100 }],
      ['bundled:done-path', { percent: 100 }],
    ]);
    expect(selectCompletionSuggestions(items, progress, context).map((item) => item.id)).toEqual(['next']);
  });

  it('prioritizes the next unfinished bundled member of a containing curated path', () => {
    const path = guide('path', {
      key: 'curated:path',
      format: 'path',
      memberIds: ['current', 'next'],
      curatedPath: { id: 'path', title: 'Path', description: '', guides: ['current', 'next'], badgeId: 'badge' },
    });
    const items = [guide('alpha'), guide('next', { category: 'metrics' }), path, guide('current')];
    const progress = new Map([['curated:path', { percent: 50, nextId: 'next' }]]);
    expect(selectCompletionSuggestions(items, progress, context).map((item) => item.id)).toEqual(['next', 'alpha']);
    expect(selectCompletionSuggestions(items, new Map(), context).map((item) => item.id)).toEqual(['next', 'alpha']);
    expect(selectCompletionSuggestions(items, progress, { ...context, inPath: true }).map((item) => item.id)).toEqual([
      'alpha',
      'path',
    ]);
  });

  it('does not infer curated membership from an online guide with a colliding bundled id', () => {
    const path = guide('path', {
      key: 'curated:path',
      format: 'path',
      category: 'metrics',
      memberIds: ['current', 'next'],
      curatedPath: { id: 'path', title: 'Path', description: '', guides: ['current', 'next'], badgeId: 'badge' },
    });
    const items = [
      guide('current', { url: 'https://grafana.com/current' }),
      guide('next', { category: 'metrics' }),
      path,
    ];
    expect(
      selectCompletionSuggestions(items, new Map([['curated:path', { percent: 50, nextId: 'next' }]]), {
        ...context,
        url: 'https://grafana.com/current',
        id: 'current',
      })
    ).toEqual([]);
  });

  it('never matches private ids or categories to public content', () => {
    expect(
      selectCompletionSuggestions([guide('current'), guide('next')], new Map(), { ...context, public: false })
    ).toEqual([]);
  });

  it('normalizes category aliases and public content URL query, fragment and file aliases', () => {
    const items = [
      guide('current', { url: 'https://grafana.com/current?track=a' }),
      guide('next', { category: 'visualizations' }),
    ];
    expect(
      selectCompletionSuggestions(items, new Map(), {
        ...context,
        url: 'https://grafana.com/current/content.json?track=b#complete',
      }).map((item) => item.id)
    ).toEqual(['next']);
  });

  it('excludes the active path by confirmed public id or normalized base URL', () => {
    const items = [
      guide('current'),
      guide('path', { format: 'path', url: 'https://grafana.com/path/content.json' }),
      guide('next'),
    ];
    for (const pathContext of [{ pathId: 'path' }, { pathUrl: 'https://grafana.com/path/?track=a#module' }]) {
      expect(
        selectCompletionSuggestions(items, new Map(), { ...context, inPath: true, ...pathContext }).map(
          (item) => item.id
        )
      ).toEqual(['next']);
    }
  });

  it('does not recommend completed curated paths or their completed members', () => {
    const items = [
      guide('current'),
      guide('next'),
      guide('path', {
        format: 'path',
        memberIds: ['current', 'next'],
        curatedPath: { id: 'path', title: 'Path', description: '', guides: ['current', 'next'], badgeId: 'badge' },
      }),
    ];
    const progress = new Map([
      ['bundled:path', { percent: 100 }],
      ['bundled:next', { percent: 100 }],
    ]);
    expect(selectCompletionSuggestions(items, progress, context)).toEqual([]);
  });

  it('offers no topic suggestions for missing, generic or unknown categories', () => {
    for (const category of [undefined, 'general', 'uncategorized', 'unknown']) {
      expect(selectCompletionSuggestions([guide('other')], new Map(), { ...context, category })).toEqual([]);
    }
  });

  it('returns at most two stable suggestions, deduplicating ids and normalized URLs', () => {
    const items = [
      guide('z'),
      guide('a'),
      guide('b'),
      guide('a', { key: 'online:a', url: 'https://grafana.com/a' }),
      guide('a-alias', { url: 'bundled:a' }),
      guide('current'),
    ];
    expect(selectCompletionSuggestions(items, new Map(), context).map((item) => item.id)).toEqual(['a', 'b']);
    expect(selectCompletionSuggestions([...items].reverse(), new Map(), context).map((item) => item.id)).toEqual([
      'a',
      'b',
    ]);
  });
});
