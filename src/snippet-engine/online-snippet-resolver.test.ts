import { createOnlineSnippetResolver, deriveSnippetsBaseUrl } from './online-snippet-resolver';

jest.mock('../lib/package-recommendations-client', () => ({
  fetchOnlinePackageRecommendations: jest.fn(),
}));

import { fetchOnlinePackageRecommendations } from '../lib/package-recommendations-client';

const mockRecommendations = fetchOnlinePackageRecommendations as jest.MockedFunction<
  typeof fetchOnlinePackageRecommendations
>;

const PACKAGES_BASE = 'https://interactive-learning.grafana.net/packages';
const SNIPPETS_BASE = 'https://interactive-learning.grafana.net/guides/shared/snippets';

const validSnippet = {
  id: 'datasource-picker',
  title: 'Datasource picker',
  description: 'Select the datasource.',
  blocks: [{ type: 'markdown', content: 'Select the datasource.' }],
};

function mockFetchResolved(value: { ok: boolean; status?: number; json?: () => Promise<unknown> }) {
  global.fetch = jest.fn().mockResolvedValue(value) as unknown as typeof fetch;
}

describe('deriveSnippetsBaseUrl', () => {
  it('swaps a trailing /packages segment for /guides/shared/snippets', () => {
    expect(deriveSnippetsBaseUrl('https://interactive-learning.grafana.net/packages')).toBe(
      'https://interactive-learning.grafana.net/guides/shared/snippets'
    );
  });

  it('tolerates a trailing slash on the input', () => {
    expect(deriveSnippetsBaseUrl('https://interactive-learning.grafana.net/packages/')).toBe(
      'https://interactive-learning.grafana.net/guides/shared/snippets'
    );
  });

  it('appends /guides/shared/snippets to non-/packages roots as a defensive fallback', () => {
    expect(deriveSnippetsBaseUrl('https://example.test')).toBe('https://example.test/guides/shared/snippets');
  });

  it('returns empty for empty input so callers can short-circuit', () => {
    expect(deriveSnippetsBaseUrl('')).toBe('');
    expect(deriveSnippetsBaseUrl('///')).toBe('');
  });
});

describe('OnlineCdnSnippetResolver.resolve', () => {
  beforeEach(() => {
    mockRecommendations.mockResolvedValue({ baseUrl: PACKAGES_BASE, packages: [] });
  });

  it('fetches the snippet from the /guides/shared/snippets path and returns the validated body', async () => {
    mockFetchResolved({ ok: true, json: async () => validSnippet });

    const result = await createOnlineSnippetResolver().resolve('datasource-picker');

    expect(global.fetch).toHaveBeenCalledWith(
      `${SNIPPETS_BASE}/datasource-picker.json`,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(result).toMatchObject({ ok: true, id: 'datasource-picker', source: 'online-cdn' });
  });

  it('encodes the snippet id so a crafted id cannot escape the snippets path', async () => {
    mockFetchResolved({ ok: false, status: 404 });

    await createOnlineSnippetResolver().resolve('../../etc/passwd');

    expect(global.fetch).toHaveBeenCalledWith(`${SNIPPETS_BASE}/..%2F..%2Fetc%2Fpasswd.json`, expect.anything());
  });

  it('returns a network-error failure on a non-ok HTTP response (no throw)', async () => {
    mockFetchResolved({ ok: false, status: 404 });

    const result = await createOnlineSnippetResolver().resolve('missing');

    expect(result).toMatchObject({ ok: false, error: { code: 'network-error' } });
  });

  it('returns a validation-error failure when the remote body fails the schema (no throw)', async () => {
    mockFetchResolved({ ok: true, json: async () => ({ id: 'datasource-picker' }) });

    const result = await createOnlineSnippetResolver().resolve('datasource-picker');

    expect(result).toMatchObject({ ok: false, error: { code: 'validation-error' } });
  });

  it('returns a network-error failure when fetch rejects', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;

    const result = await createOnlineSnippetResolver().resolve('datasource-picker');

    expect(result).toMatchObject({ ok: false, error: { code: 'network-error' } });
  });

  it('fails without fetching when no base URL is available', async () => {
    mockRecommendations.mockResolvedValue({ baseUrl: '', packages: [] });
    global.fetch = jest.fn() as unknown as typeof fetch;

    const result = await createOnlineSnippetResolver().resolve('datasource-picker');

    expect(global.fetch).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, error: { code: 'network-error' } });
  });
});

describe('OnlineCdnSnippetResolver.list', () => {
  beforeEach(() => {
    mockRecommendations.mockResolvedValue({ baseUrl: PACKAGES_BASE, packages: [] });
  });

  it('fetches and returns the parsed catalog from index.json', async () => {
    const catalog = {
      'datasource-picker': { id: 'datasource-picker', title: 'Datasource picker', description: 'Pick a datasource' },
    };
    mockFetchResolved({ ok: true, json: async () => catalog });

    const result = await createOnlineSnippetResolver().list();

    expect(global.fetch).toHaveBeenCalledWith(
      `${SNIPPETS_BASE}/index.json`,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(result).toEqual(catalog);
  });

  it('returns an empty catalog on any fetch failure (non-ok, malformed body, or rejection)', async () => {
    mockFetchResolved({ ok: false, status: 500 });
    expect(await createOnlineSnippetResolver().list()).toEqual({});

    mockFetchResolved({ ok: true, json: async () => [{ not: 'a catalog' }] });
    expect(await createOnlineSnippetResolver().list()).toEqual({});

    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    expect(await createOnlineSnippetResolver().list()).toEqual({});
  });
});

describe('OnlineCdnSnippetResolver deadline (PR #1446 review finding 4)', () => {
  // A CDN request that never settles must not hang the caller forever:
  // prepareGuideLaunch awaits snippet resolution before committing a launch
  // surface, and MyLearningTab's in-flight guard blocks all later launches
  // until it returns. Both fetches carry AbortSignal.timeout; an abort flows
  // through the existing catch into the unresolved-snippet fail-safe.
  beforeEach(() => {
    mockRecommendations.mockResolvedValue({ baseUrl: PACKAGES_BASE, packages: [] });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function mockNeverSettlingFetch(): AbortController {
    const controller = new AbortController();
    jest.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    global.fetch = jest.fn(
      (_url: unknown, options?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          const abort = () => reject(new DOMException('This operation was aborted', 'AbortError'));
          if (options?.signal?.aborted) {
            abort();
            return;
          }
          options?.signal?.addEventListener('abort', abort);
        })
    ) as unknown as typeof fetch;
    return controller;
  }

  it('a never-settling snippet fetch resolves to a network-error failure when the deadline fires', async () => {
    const controller = mockNeverSettlingFetch();

    const pending = createOnlineSnippetResolver().resolve('datasource-picker');
    controller.abort();

    expect(await pending).toMatchObject({ ok: false, error: { code: 'network-error' } });
  });

  it('a never-settling catalog fetch resolves to an empty catalog when the deadline fires', async () => {
    const controller = mockNeverSettlingFetch();

    const pending = createOnlineSnippetResolver().list();
    controller.abort();

    expect(await pending).toEqual({});
  });
});
