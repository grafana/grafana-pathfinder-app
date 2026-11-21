import { readFileSync } from 'fs';
import { join } from 'path';

import type { JsonBlock } from '../types/json-guide.types';
import { segmentGuide, type SegmentInput } from '../cli/utils/step-index/segment';

export const FIXTURE_IDS = [
  'grafana-quickpizza-working-filters',
  'create-availability-slo-create-availability-slo',
  'adaptive-metrics-value',
] as const;

export function loadFixture(id: (typeof FIXTURE_IDS)[number]): SegmentInput {
  const content = JSON.parse(
    readFileSync(join(__dirname, '../cli/utils/step-index/__tests__/fixtures', `${id}.json`), 'utf8')
  ) as {
    title: string;
    blocks: JsonBlock[];
  };
  return { id, title: content.title, pathTitles: [], blocks: content.blocks };
}

export const fixtureProcedures = () => FIXTURE_IDS.flatMap((id) => segmentGuide(loadFixture(id)));

const BASE = 'https://interactive-learning.grafana.net/packages/';
// Captured from https://interactive-learning.grafana.net/packages/<path>content.json on 2026-11-18.
const FIXTURE_PATHS: Record<(typeof FIXTURE_IDS)[number], string> = {
  'grafana-quickpizza-working-filters': 'grafana-quickpizza-working-filters/',
  'create-availability-slo-create-availability-slo': 'create-availability-slo-lj/create-availability-slo/',
  'adaptive-metrics-value': 'adaptive-metrics-lj/value-adaptive-metrics/',
};

export interface StepIndexFetchOptions {
  revision?: number;
  healthStatus?: number;
  healthBody?: unknown;
  /** Extra catalog entries, to change the catalog without touching the health report. */
  extraCatalog?: Record<string, unknown>;
  /** Per guide id and attempt: a status for a failed fetch, or a body to serve instead of the fixture. */
  content?: (id: string, attempt: number) => number | Record<string, unknown> | undefined;
  /** Health entries replacing the default `healthy` ones. */
  healthPackages?: Record<string, unknown>;
}

/** A `fetch` double serving the catalog, the health report and the fixture guides, with one unhealthy guide. */
export function mockStepIndexFetch(options: StepIndexFetchOptions = {}): jest.Mock {
  const respond = (status: number, body?: unknown) => ({
    ok: status === 200,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: new Headers(),
    json: async () => body,
  });
  const catalog = {
    ...Object.fromEntries(
      FIXTURE_IDS.map((id) => [id, { path: FIXTURE_PATHS[id], title: loadFixture(id).title, type: 'guide' }])
    ),
    'unhealthy-guide': { path: 'unhealthy-guide/', title: 'Unhealthy guide', type: 'guide' },
    ...options.extraCatalog,
    'dashboards-path': {
      path: 'dashboards-path/',
      title: 'Dashboards learning path',
      type: 'path',
      milestones: [
        'grafana-quickpizza-working-filters',
        'unhealthy-guide',
        'create-availability-slo-create-availability-slo',
      ],
    },
  };
  const healthy = { health: 'healthy', blockedBy: [] };
  const health = {
    schemaVersion: '1.0',
    revision: options.revision ?? 1,
    generatedAt: '2026-11-18T00:00:00Z',
    packages: {
      ...Object.fromEntries(FIXTURE_IDS.map((id) => [id, healthy])),
      'unhealthy-guide': { health: 'unhealthy', blockedBy: [] },
      ...options.healthPackages,
    },
  };
  const attempts = new Map<string, number>();
  return jest.fn(async (url: string) => {
    if (url.includes('package-health')) {
      return respond(options.healthStatus ?? 200, options.healthBody ?? health);
    }
    if (url === `${BASE}repository.json`) {
      return respond(200, catalog);
    }
    const id = FIXTURE_IDS.find((candidate) => url === `${BASE}${FIXTURE_PATHS[candidate]}content.json`);
    if (!id) {
      return respond(404);
    }
    const attempt = (attempts.get(id) ?? 0) + 1;
    attempts.set(id, attempt);
    const override = options.content?.(id, attempt);
    if (typeof override === 'number') {
      return respond(override);
    }
    if (override) {
      return respond(200, override);
    }
    return respond(
      200,
      JSON.parse(readFileSync(join(__dirname, '../cli/utils/step-index/__tests__/fixtures', `${id}.json`), 'utf8'))
    );
  });
}
