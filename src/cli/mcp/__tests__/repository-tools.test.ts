/**
 * @jest-environment node
 *
 * Integration tests for the P6 repository tool group. Each test boots a
 * real MCP server pair (InMemoryTransport) and exercises the tools via
 * `client.callTool`, parsing the JSON text block. `global.fetch` is
 * mocked at module scope so no real network I/O happens.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { __resetRepositoryClientForTests, REPOSITORY_URL_ENV_VAR } from '../lib/repository-client';
import { buildServer } from '../server';

const sampleIndex = {
  'business-value': {
    path: 'business-value/',
    type: 'guide',
    title: 'Business value',
    description: 'A guide about value.',
    category: 'observability',
  },
  'getting-started': {
    path: 'getting-started/',
    type: 'guide',
    title: 'Getting started',
    description: 'First steps with Grafana.',
    category: 'onboarding',
  },
  'tour-journey': {
    path: 'tour-journey/',
    type: 'journey',
    title: 'Grafana tour',
    description: 'Take a tour.',
    category: 'onboarding',
    milestones: ['business-value'],
  },
};

const sampleContent = {
  schemaVersion: '1.0.0',
  id: 'business-value',
  title: 'Business value',
  blocks: [{ type: 'markdown', id: 'm-1', content: 'hi' }],
};

const sampleManifest = {
  schemaVersion: '1.0.0',
  id: 'business-value',
  type: 'guide',
  description: 'A guide.',
};

let fetchMock: jest.Mock;

function mockFetchJsonOnce(body: unknown, init: { ok?: boolean; status?: number; statusText?: string } = {}): void {
  const ok = init.ok !== false;
  fetchMock.mockResolvedValueOnce({
    ok,
    status: init.status ?? (ok ? 200 : 500),
    statusText: init.statusText ?? (ok ? 'OK' : 'Internal Server Error'),
    json: async () => body,
  });
}

interface ToolPayload {
  status?: string;
  code?: string;
  [key: string]: unknown;
}

async function callTool(name: string, args: Record<string, unknown>): Promise<ToolPayload> {
  const server = buildServer();
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'p6-test', version: '0' }, { capabilities: {} });
  await client.connect(clientTransport);
  try {
    const result = await client.callTool({ name, arguments: args });
    const blocks = result.content as Array<{ type: string; text: string }>;
    const text = blocks.find((b) => b.type === 'text')?.text;
    if (!text) {
      throw new Error(`${name} returned no text block`);
    }
    return JSON.parse(text) as ToolPayload;
  } finally {
    await client.close();
    await server.close();
  }
}

beforeEach(() => {
  __resetRepositoryClientForTests();
  delete process.env[REPOSITORY_URL_ENV_VAR];
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('pathfinder_list_packages', () => {
  it('returns all packages from the index when no filters are supplied', async () => {
    mockFetchJsonOnce(sampleIndex);
    const payload = await callTool('pathfinder_list_packages', {});
    expect(payload.baseUrl).toBe('https://interactive-learning.grafana.net/packages/');
    const packages = payload.packages as Array<{ id: string }>;
    expect(packages.map((p) => p.id).sort()).toEqual(['business-value', 'getting-started', 'tour-journey']);
  });

  it('filters by type', async () => {
    mockFetchJsonOnce(sampleIndex);
    const payload = await callTool('pathfinder_list_packages', { type: 'journey' });
    const packages = payload.packages as Array<{ id: string }>;
    expect(packages.map((p) => p.id)).toEqual(['tour-journey']);
  });

  it('filters by category', async () => {
    mockFetchJsonOnce(sampleIndex);
    const payload = await callTool('pathfinder_list_packages', { category: 'onboarding' });
    const packages = payload.packages as Array<{ id: string }>;
    expect(packages.map((p) => p.id).sort()).toEqual(['getting-started', 'tour-journey']);
  });

  it('matches q against title and description, case-insensitive', async () => {
    mockFetchJsonOnce(sampleIndex);
    const payload = await callTool('pathfinder_list_packages', { q: 'TOUR' });
    const packages = payload.packages as Array<{ id: string }>;
    // Matches "Grafana tour" title and "Take a tour." description.
    expect(packages.map((p) => p.id)).toEqual(['tour-journey']);
  });

  it('surfaces network errors from the index fetch', async () => {
    fetchMock.mockRejectedValueOnce(new Error('connection refused'));
    const payload = await callTool('pathfinder_list_packages', {});
    expect(payload.status).toBe('error');
    expect(payload.code).toBe('NETWORK_ERROR');
  });
});

describe('pathfinder_get_package', () => {
  it('returns content + manifest with validation reports on the happy path', async () => {
    mockFetchJsonOnce(sampleIndex);
    mockFetchJsonOnce(sampleContent);
    mockFetchJsonOnce(sampleManifest);
    const payload = await callTool('pathfinder_get_package', { id: 'business-value' });
    expect(payload.id).toBe('business-value');
    const content = payload.content as { url: string; raw: unknown; validation: { isValid: boolean } };
    const manifest = payload.manifest as { url: string; raw: unknown; validation: { isValid: boolean } };
    expect(content.url).toBe('https://interactive-learning.grafana.net/packages/business-value/content.json');
    expect(manifest.url).toBe('https://interactive-learning.grafana.net/packages/business-value/manifest.json');
    expect(content.raw).toEqual(sampleContent);
    expect(manifest.raw).toEqual(sampleManifest);
    expect(content.validation.isValid).toBe(true);
    expect(manifest.validation.isValid).toBe(true);
  });

  it('surfaces drift in raw + validation issues without hard-failing', async () => {
    mockFetchJsonOnce(sampleIndex);
    const driftedContent = { ...sampleContent, blocks: 'not an array' };
    mockFetchJsonOnce(driftedContent);
    mockFetchJsonOnce(sampleManifest);
    const payload = await callTool('pathfinder_get_package', { id: 'business-value' });
    const content = payload.content as { raw: unknown; validation: { isValid: boolean; issues: unknown[] } };
    expect(content.raw).toEqual(driftedContent);
    expect(content.validation.isValid).toBe(false);
    expect(content.validation.issues.length).toBeGreaterThan(0);
  });

  it('returns NOT_FOUND for an unknown id', async () => {
    mockFetchJsonOnce(sampleIndex);
    const payload = await callTool('pathfinder_get_package', { id: 'does-not-exist' });
    expect(payload.status).toBe('error');
    expect(payload.code).toBe('NOT_FOUND');
  });
});

describe('pathfinder_get_manifest', () => {
  it('returns manifest only on the happy path', async () => {
    mockFetchJsonOnce(sampleIndex);
    mockFetchJsonOnce(sampleManifest);
    const payload = await callTool('pathfinder_get_manifest', { id: 'business-value' });
    const manifest = payload.manifest as { url: string; raw: unknown };
    expect(manifest.url).toBe('https://interactive-learning.grafana.net/packages/business-value/manifest.json');
    expect(manifest.raw).toEqual(sampleManifest);
    expect(payload.content).toBeUndefined();
  });

  it('returns NOT_FOUND for an unknown id', async () => {
    mockFetchJsonOnce(sampleIndex);
    const payload = await callTool('pathfinder_get_manifest', { id: 'nope' });
    expect(payload.status).toBe('error');
    expect(payload.code).toBe('NOT_FOUND');
  });
});

describe('pathfinder_launch_package', () => {
  it('returns a relative launchPath plus a usage hint when instanceUrl is omitted', async () => {
    mockFetchJsonOnce(sampleIndex);
    const payload = await callTool('pathfinder_launch_package', { id: 'business-value' });
    expect(payload.cdnContentUrl).toBe('https://interactive-learning.grafana.net/packages/business-value/content.json');
    expect(payload.launchPath).toBe(
      `/a/grafana-pathfinder-app?doc=${encodeURIComponent('https://interactive-learning.grafana.net/packages/business-value/content.json')}`
    );
    expect(payload.launchUrl).toBeUndefined();
    // The usage hint must tell the agent (a) launchPath is relative,
    // (b) not to fabricate a hostname.
    const usage = payload.usage as { launchPathIsRelative: boolean; message: string };
    expect(usage.launchPathIsRelative).toBe(true);
    expect(usage.message).toMatch(/relative/i);
    expect(usage.message).toMatch(/do not fabricate|not.*fabricate/i);
  });

  it('returns an absolute launchUrl and no usage hint when instanceUrl is provided', async () => {
    mockFetchJsonOnce(sampleIndex);
    const payload = await callTool('pathfinder_launch_package', {
      id: 'business-value',
      instanceUrl: 'https://stack1.grafana.net/',
    });
    expect(payload.launchUrl).toBe(
      `https://stack1.grafana.net/a/grafana-pathfinder-app?doc=${encodeURIComponent('https://interactive-learning.grafana.net/packages/business-value/content.json')}`
    );
    expect(payload.usage).toBeUndefined();
  });

  it('appends panelMode=floating when requested', async () => {
    mockFetchJsonOnce(sampleIndex);
    const payload = await callTool('pathfinder_launch_package', {
      id: 'business-value',
      panelMode: 'floating',
    });
    expect(typeof payload.launchPath).toBe('string');
    expect((payload.launchPath as string).endsWith('&panelMode=floating')).toBe(true);
  });

  it('combines instanceUrl and panelMode=floating', async () => {
    mockFetchJsonOnce(sampleIndex);
    const payload = await callTool('pathfinder_launch_package', {
      id: 'business-value',
      instanceUrl: 'https://stack1.grafana.net',
      panelMode: 'floating',
    });
    expect((payload.launchUrl as string).startsWith('https://stack1.grafana.net/a/grafana-pathfinder-app?doc=')).toBe(
      true
    );
    expect((payload.launchUrl as string).endsWith('&panelMode=floating')).toBe(true);
  });

  it('honors the PATHFINDER_REPOSITORY_URL override end-to-end', async () => {
    process.env[REPOSITORY_URL_ENV_VAR] = 'https://staging.example/packages';
    mockFetchJsonOnce(sampleIndex);
    const payload = await callTool('pathfinder_launch_package', { id: 'business-value' });
    expect(payload.cdnContentUrl).toBe('https://staging.example/packages/business-value/content.json');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://staging.example/packages/repository.json',
      expect.objectContaining({ signal: expect.anything() })
    );
  });

  it('returns NOT_FOUND for an unknown id', async () => {
    mockFetchJsonOnce(sampleIndex);
    const payload = await callTool('pathfinder_launch_package', { id: 'nope' });
    expect(payload.status).toBe('error');
    expect(payload.code).toBe('NOT_FOUND');
  });
});
