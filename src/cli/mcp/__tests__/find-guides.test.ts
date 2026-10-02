/**
 * @jest-environment node
 *
 * `pathfinder_find_guides` through a real MCP server pair. `global.fetch` is
 * mocked so no network I/O happens.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import snapshot from '../lib/guide-search/__tests__/fixtures/catalog-snapshot.json';
import { __resetRepositoryClientForTests, REPOSITORY_URL_ENV_VAR } from '../../utils/repository-client';
import { buildServer } from '../server';
import { __resetFindGuidesForTests } from '../tools/find-guides';

const BASE = 'https://interactive-learning.grafana.net/packages/';
const doc = (id: string) => encodeURIComponent(`${BASE}${id}/content.json`);

const sampleIndex = {
  'kubernetes-lp': {
    path: 'kubernetes-lp/',
    type: 'path',
    title: 'Monitor Kubernetes clusters',
    description: 'A learning path.',
    category: 'learning-path',
    startingLocation: '/a/grafana-k8s-app',
    milestones: ['kubernetes-lp-alerts'],
    author: { name: 'someone' },
    testEnvironment: { tier: 'cloud' },
  },
  'kubernetes-lp-alerts': {
    path: 'kubernetes-lp-alerts/',
    type: 'guide',
    title: 'Install Kubernetes alerting rules',
    category: 'take-action',
  },
  'alerting-101': {
    path: 'alerting-101/',
    type: 'guide',
    title: 'Alerting 101',
    description: '',
    category: 'general',
    targeting: { match: { or: [{ urlRegex: '^/(a+)+$' }, { urlPrefix: '/alerting' }] } },
  },
};

let fetchMock: jest.Mock;

function mockIndexOnce(body: unknown, headers: Record<string, string> = {}): void {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers(headers),
    json: async () => body,
  });
}

async function callFind(args: Record<string, unknown>): Promise<{ isError: boolean; payload: any; text: string }> {
  const server = buildServer();
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'find-guides-test', version: '0' }, { capabilities: {} });
  await client.connect(clientTransport);
  try {
    const result = await client.callTool({ name: 'pathfinder_find_guides', arguments: args });
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
    let payload: unknown = text;
    try {
      payload = JSON.parse(text);
    } catch {}
    return { isError: result.isError === true, payload, text };
  } finally {
    await client.close();
    await server.close();
  }
}

beforeEach(() => {
  __resetRepositoryClientForTests();
  __resetFindGuidesForTests();
  delete process.env[REPOSITORY_URL_ENV_VAR];
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('pathfinder_find_guides', () => {
  it('returns grouped, linked results with the catalog version and no raw catalog fields', async () => {
    mockIndexOnce(sampleIndex, { etag: 'W/"v1"' });
    const { isError, payload } = await callFind({ queries: ['kubernetes alerting'] });
    expect(isError).toBe(false);
    expect(payload).toEqual({
      results: [
        {
          id: 'kubernetes-lp',
          type: 'path',
          title: 'Monitor Kubernetes clusters',
          description: 'A learning path.',
          category: 'learning-path',
          relevance: 'strong',
          matchedOn: ['title', 'id'],
          startsIn: '/a/grafana-k8s-app',
          launchPath: `/a/grafana-pathfinder-app?doc=${doc('kubernetes-lp')}&type=learning-journey`,
          stepCount: 1,
          matchedSteps: [{ id: 'kubernetes-lp-alerts', title: 'Install Kubernetes alerting rules', step: 1 }],
        },
        expect.objectContaining({ id: 'alerting-101', relevance: 'partial' }),
      ],
      totalMatches: 2,
      noStrongMatch: false,
      catalogVersion: 'W/"v1"',
    });
    expect(payload.results[1]).not.toHaveProperty('description');
  });

  it('adds launchUrl when instanceUrl is known', async () => {
    mockIndexOnce(sampleIndex);
    const { payload } = await callFind({ queries: ['alerting 101'], instanceUrl: 'https://stack1.grafana.net/' });
    expect(payload.results[0].launchUrl).toBe(
      `https://stack1.grafana.net/a/grafana-pathfinder-app?doc=${doc('alerting-101')}`
    );
    expect(payload).not.toHaveProperty('catalogVersion');
  });

  it('rejects a call with neither queries nor pageUrl, and a non-http instanceUrl', async () => {
    expect((await callFind({})).isError).toBe(true);
    expect((await callFind({ queries: ['x'], instanceUrl: 'javascript:alert(1)' })).isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lists valid categories when a category is unknown', async () => {
    mockIndexOnce(sampleIndex);
    const { isError, payload } = await callFind({ queries: ['alerting'], categories: ['nope'] });
    expect(isError).toBe(true);
    expect(payload).toMatchObject({
      status: 'error',
      code: 'UNKNOWN_CATEGORY',
      categories: ['general', 'learning-path', 'take-action'],
    });
  });

  it('returns the valid categories with an empty result', async () => {
    mockIndexOnce(sampleIndex);
    const { payload } = await callFind({ queries: ['quantum'] });
    expect(payload).toEqual({
      results: [],
      totalMatches: 0,
      noStrongMatch: true,
      categories: ['general', 'learning-path', 'take-action'],
    });
  });

  it('stays responsive when the catalog carries a catastrophic urlRegex', async () => {
    mockIndexOnce(sampleIndex);
    const started = Date.now();
    const { payload } = await callFind({ pageUrl: `/${'a'.repeat(40)}!` });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(payload.results).toEqual([]);
  });

  it('surfaces repository fetch errors', async () => {
    fetchMock.mockRejectedValueOnce(new Error('connection refused'));
    const { isError, payload } = await callFind({ queries: ['alerting'] });
    expect(isError).toBe(true);
    expect(payload).toMatchObject({ status: 'error', code: 'NETWORK_ERROR' });
  });

  it('rebuilds the search index only when the catalog version changes', async () => {
    const nowSpy = jest.spyOn(Date, 'now');
    try {
      nowSpy.mockReturnValue(0);
      mockIndexOnce(sampleIndex, { etag: 'W/"v1"' });
      const firstCall = (await callFind({ queries: ['alerting 101'] })).payload.results;
      expect(firstCall.length).toBeGreaterThan(0);

      nowSpy.mockReturnValue(61_000);
      mockIndexOnce({}, { etag: 'W/"v1"' });
      expect((await callFind({ queries: ['alerting 101'] })).payload.results).toEqual(firstCall);

      nowSpy.mockReturnValue(122_000);
      mockIndexOnce({}, { etag: 'W/"v2"' });
      expect((await callFind({ queries: ['alerting 101'] })).payload.results).toHaveLength(0);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('keeps five results from the real catalog small', async () => {
    mockIndexOnce(snapshot);
    const { payload, text } = await callFind({ queries: ['adaptive logs', 'reduce log volume', 'log cost'] });
    expect(payload.results).toHaveLength(5);
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThan(3072);
  });
});
