import { readFileSync } from 'fs';
import { join } from 'path';
import type { ContextData } from '../types/context.types';
import { RECOMMENDATION_CONTEXT_FIELDS, recommendationsInputKey } from './recommendation-inputs';

const serviceSource = readFileSync(join(__dirname, 'context.service.ts'), 'utf8');
const fields: readonly string[] = RECOMMENDATION_CONTEXT_FIELDS;

const context = (overrides: Partial<ContextData> = {}): ContextData =>
  ({
    currentPath: '/explore',
    tags: ['explore:query'],
    platform: 'cloud',
    dataSources: [{ id: 1, uid: 'a', name: 'Prometheus', type: 'prometheus' }],
    ...overrides,
  }) as ContextData;

describe('RECOMMENDATION_CONTEXT_FIELDS', () => {
  it('covers every ContextData field the recommender reads', () => {
    const read = new Set([...serviceSource.matchAll(/\bcontextData\??\.(\w+)/g)].map((match) => match[1] ?? ''));
    const unkeyed = [...read].filter((field) => !fields.includes(field));

    expect(read.size).toBeGreaterThan(0);
    expect(unkeyed).toEqual([]);
  });

  it('sees every read, because the service only hands contextData to its own methods', () => {
    const escapes = serviceSource
      .split('\n')
      .filter((line) => /\bcontextData\b(?!\??\.|: ContextData)/.test(line))
      .filter((line) => !/this\.\w+\((?:[^()]*,\s*)?contextData\b/.test(line));

    expect(escapes).toEqual([]);
  });

  it('names every ContextData parameter contextData so the scan above can find its reads', () => {
    const parameterNames = [...serviceSource.matchAll(/(\w+)\??: ContextData\b(?!\[)/g)].map((match) => match[1]);

    expect(parameterNames.length).toBeGreaterThan(0);
    expect(parameterNames.filter((name) => name !== 'contextData')).toEqual([]);
  });
});

describe('recommendationsInputKey', () => {
  it.each(RECOMMENDATION_CONTEXT_FIELDS)('changes when %s changes', (field) => {
    const changed: Partial<ContextData> = {
      currentPath: { currentPath: '/dashboards' },
      tags: { tags: ['dashboard:view'] },
      platform: { platform: 'oss' as const },
      dataSources: { dataSources: [{ id: 2, uid: 'b', name: 'Loki', type: 'loki' }] },
    }[field];

    expect(recommendationsInputKey(context(changed))).not.toBe(recommendationsInputKey(context()));
  });

  it('ignores datasource order, duplicates, and fields the recommender does not read', () => {
    const prometheus = { id: 1, uid: 'a', name: 'Prometheus', type: 'prometheus' };
    const loki = { id: 2, uid: 'b', name: 'Loki', type: 'loki' };

    expect(
      recommendationsInputKey(
        context({ dataSources: [loki, prometheus, { ...prometheus, uid: 'c' }], timestamp: 'later' })
      )
    ).toBe(recommendationsInputKey(context({ dataSources: [prometheus, loki] })));
  });
});
