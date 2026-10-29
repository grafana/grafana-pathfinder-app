import type { CatalogPackage } from '../types/package-catalog.types';
import bundledRepository from '../bundled-interactives/repository.json';
import { completionSuggestionReason, selectCompletionSuggestions } from './completion-suggestions';

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
const authoredContext = { ...context, suggests: ['a-compatible', 'b-unspecified', 'c-unknown'] };

describe('selectCompletionSuggestions', () => {
  it('uses only authored suggestions in declared order, never soft prerequisites', () => {
    const items = [
      guide('current'),
      guide('alpha'),
      guide('z-recommended'),
      guide('y-recommended'),
      guide('x-suggested'),
    ];
    const authored = { ...context, recommends: ['z-recommended', 'y-recommended'], suggests: ['x-suggested', 'alpha'] };
    const selected = selectCompletionSuggestions(items, new Map(), authored);
    expect(selected.map((item) => item.id)).toEqual(['x-suggested', 'alpha']);
    expect(completionSuggestionReason(items[2]!, authored)).toBe('inferred');
    expect(completionSuggestionReason(items[4]!, authored)).toBe('suggested');
    expect(completionSuggestionReason(items[1]!, authored)).toBe('suggested');
  });

  it('chooses eligible OR alternatives and skips groups satisfied by a completed alternative', () => {
    const items = [guide('current'), guide('done'), guide('alternative'), guide('suggested'), guide('topic')];
    const selected = selectCompletionSuggestions(items, new Map([['bundled:done', { percent: 100 }]]), {
      ...context,
      suggests: [['missing', 'alternative'], ['done', 'suggested'], 'topic'],
    });
    expect(selected.map((item) => item.id)).toEqual(['alternative', 'topic']);
  });

  it('uses valid authored suggestions without padding the shortlist with inferred filler', () => {
    const items = [guide('current'), guide('alpha'), guide('z-authored', { category: 'metrics' })];
    expect(
      selectCompletionSuggestions(items, new Map(), {
        ...context,
        suggests: ['z-authored'],
      }).map((item) => item.id)
    ).toEqual(['z-authored']);
  });

  it('excludes completed authored candidates while retaining partially completed OR alternatives', () => {
    const items = [guide('current'), guide('done', { category: 'metrics' }), guide('partial', { category: 'metrics' })];
    const progress = new Map([
      ['bundled:done', { percent: 100 }],
      ['bundled:partial', { percent: 50 }],
    ]);
    expect(
      selectCompletionSuggestions(items, progress, {
        ...context,
        suggests: ['done', ['missing', 'partial']],
      }).map((item) => item.id)
    ).toEqual(['partial']);
  });

  it('allows only explicit organization relationships for private content with colliding public ids', () => {
    const items = [
      guide('current'),
      guide('next'),
      guide('topic-private', {
        source: 'organization',
        key: 'app-platform:topic-private',
        url: 'backend-guide:topic-private',
      }),
      guide('next', { source: 'organization', key: 'app-platform:next', url: 'backend-guide:next' }),
    ];
    const privateContext = {
      ...context,
      public: false,
      source: 'organization' as const,
      url: 'backend-guide:current',
      id: 'current',
      category: 'dashboards',
      suggests: ['next', 'missing'],
    };
    const selected = selectCompletionSuggestions(items, new Map([['bundled:next', { percent: 100 }]]), privateContext);
    expect(selected.map((item) => item.key)).toEqual(['app-platform:next']);
    expect(completionSuggestionReason(selected[0]!, privateContext)).toBe('suggested');
    expect(completionSuggestionReason(items[1]!, privateContext)).toBe('inferred');
    expect(selectCompletionSuggestions(items, new Map(), { ...privateContext, suggests: [] })).toEqual([]);
    expect(selectCompletionSuggestions(items, new Map(), { ...privateContext, source: undefined })).toEqual([]);
  });

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
    expect(
      selectCompletionSuggestions(items, new Map(), { ...authoredContext, platform }).map((item) => item.id)
    ).toEqual(['a-compatible', 'b-unspecified']);
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
      selectCompletionSuggestions(items, new Map(), { ...authoredContext, platform: 'oss' }).map((item) => item.id)
    ).toEqual(['a-compatible', 'c-unknown']);
    expect(
      selectCompletionSuggestions([items[0]!, items[3]!, items[4]!], new Map(), {
        ...authoredContext,
        platform: 'oss',
      }).map((item) => item.id)
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
    expect(
      selectCompletionSuggestions(items, progress, {
        ...context,
        suggests: ['current', 'private', 'done', 'done-path', 'next'],
      }).map((item) => item.id)
    ).toEqual(['next']);
  });

  it('offers the next unfinished bundled member of a containing curated path', () => {
    const path = guide('path', {
      key: 'curated:path',
      format: 'path',
      memberIds: ['current', 'next'],
      curatedPath: { id: 'path', title: 'Path', description: '', guides: ['current', 'next'], badgeId: 'badge' },
    });
    const items = [guide('alpha'), guide('next', { category: 'metrics' }), path, guide('current')];
    const progress = new Map([['curated:path', { percent: 50, nextId: 'next' }]]);
    expect(selectCompletionSuggestions(items, progress, context).map((item) => item.id)).toEqual(['next']);
    expect(selectCompletionSuggestions(items, new Map(), context).map((item) => item.id)).toEqual(['next']);
    expect(selectCompletionSuggestions(items, progress, { ...context, inPath: true }).map((item) => item.id)).toEqual(
      []
    );
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
        suggests: ['current', 'next'],
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
        selectCompletionSuggestions(items, new Map(), {
          ...context,
          inPath: true,
          suggests: ['path', 'next'],
          ...pathContext,
        }).map((item) => item.id)
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

  it.each(['getting-started', 'dashboards', 'data-sources', 'alerting', 'metrics', 'logs', 'k6'])(
    'never fills a suggestion slot from the %s topic alone',
    (category) => {
      const items = [
        guide('current', { category }),
        guide('other', { category }),
        guide('intro', { category, format: 'path' }),
      ];
      expect(selectCompletionSuggestions(items, new Map(), { ...context, category })).toEqual([]);
    }
  );

  it('does not fall back to topic matches when authored suggestions are missing or completed', () => {
    const items = [guide('current'), guide('done'), guide('other')];
    expect(
      selectCompletionSuggestions(items, new Map([['bundled:done', { percent: 100 }]]), {
        ...context,
        suggests: ['missing', 'done'],
      })
    ).toEqual([]);
  });

  it('does not send a standalone reader backwards to an earlier unfinished path member', () => {
    const path = guide('path', {
      format: 'path',
      memberIds: ['earlier', 'current', 'next'],
      curatedPath: {
        id: 'path',
        title: 'Path',
        description: '',
        guides: ['earlier', 'current', 'next'],
        badgeId: 'badge',
      },
    });
    const items = [guide('current'), guide('earlier'), guide('next'), path];
    const progress = new Map<string, { percent: number; nextId?: string }>([
      ['bundled:path', { percent: 30, nextId: 'earlier' }],
    ]);
    expect(selectCompletionSuggestions(items, progress, context).map((item) => item.id)).toEqual(['next']);
    expect(
      selectCompletionSuggestions(items, new Map([...progress, ['bundled:next', { percent: 100 }]]), context)
    ).toEqual([]);
  });
});

it('deduplicates authored targets that share the same content URL', () => {
  const a = guide('a');
  const alias = guide('alias', { url: a.url });
  expect(
    selectCompletionSuggestions([guide('current'), a, alias], new Map(), { ...context, suggests: ['a', 'alias'] })
  ).toEqual([a]);
});

it.each(['prometheus-advanced-queries', 'first-dashboard'] as const)(
  'does not recommend shipped prerequisites after completing %s directly',
  (id) => {
    const entry = bundledRepository[id];
    const items = [
      guide(id, { category: entry.category }),
      ...entry.recommends.map((id) => guide(id, { category: entry.category })),
    ];
    const completion = { ...context, url: `bundled:${id}/content.json`, id, recommends: entry.recommends };
    expect(selectCompletionSuggestions(items, new Map(), completion)).toEqual([]);
  }
);
