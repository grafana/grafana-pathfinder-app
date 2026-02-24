/**
 * Tests for fetchPathGuides
 *
 * Verifies that index.json is parsed correctly into guide IDs and metadata.
 */

import { fetchPathGuides } from './fetch-path-guides';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockClear();
});

const SAMPLE_INDEX_JSON = [
  {
    name: 'the-case-for-observability',
    relpermalink: '/docs/learning-paths/linux-server-integration/business-value/',
    params: {
      title: 'The case for observability',
      menutitle: 'The case for observability',
      grafana: { skip: true },
    },
  },
  {
    name: 'select-linux-distribution',
    relpermalink: '/docs/learning-paths/linux-server-integration/select-platform/',
    params: {
      title: 'Select Linux distribution',
      menutitle: 'Select distribution',
    },
  },
  {
    name: 'install-grafana-alloy',
    relpermalink: '/docs/learning-paths/linux-server-integration/install-alloy/',
    params: {
      title: 'Install Grafana Alloy',
      menutitle: 'Install Alloy',
    },
  },
  {
    name: 'configure-alloy',
    relpermalink: '/docs/learning-paths/linux-server-integration/configure-alloy/',
    params: {
      title: 'Configure Grafana Alloy to use the Linux server integration',
    },
  },
];

describe('fetchPathGuides', () => {
  it('fetches and parses index.json correctly', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => SAMPLE_INDEX_JSON,
    });

    const result = await fetchPathGuides('https://grafana.com/docs/learning-paths/linux-server-integration/');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://grafana.com/docs/learning-paths/linux-server-integration/index.json',
      { signal: undefined }
    );
    expect(result).not.toBeNull();
    expect(result!.guides).toEqual(['select-platform', 'install-alloy', 'configure-alloy']);
    expect(result!.guides).not.toContain('business-value');
  });

  it('filters out items with grafana.skip: true', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => SAMPLE_INDEX_JSON,
    });

    const result = await fetchPathGuides('https://grafana.com/docs/learning-paths/linux-server-integration/');

    expect(result).not.toBeNull();
    // "business-value" has grafana.skip: true and should be excluded
    expect(result!.guides).not.toContain('business-value');
    expect(result!.guideMetadata['business-value']).toBeUndefined();
  });

  it('uses menutitle over title when available', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => SAMPLE_INDEX_JSON,
    });

    const result = await fetchPathGuides('https://grafana.com/docs/learning-paths/linux-server-integration/');

    expect(result).not.toBeNull();
    // "select-platform" has both menutitle and title — should use menutitle
    expect(result!.guideMetadata['select-platform']!.title).toBe('Select distribution');
    // "configure-alloy" has only title, no menutitle
    expect(result!.guideMetadata['configure-alloy']!.title).toBe(
      'Configure Grafana Alloy to use the Linux server integration'
    );
  });

  it('returns null on fetch failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
    });

    const result = await fetchPathGuides('https://grafana.com/docs/learning-paths/nonexistent/');

    expect(result).toBeNull();
  });

  it('returns null on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const result = await fetchPathGuides('https://grafana.com/docs/learning-paths/linux-server-integration/');

    expect(result).toBeNull();
  });

  it('returns null for non-array response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ not: 'an array' }),
    });

    const result = await fetchPathGuides('https://grafana.com/docs/learning-paths/linux-server-integration/');

    expect(result).toBeNull();
  });

  it('handles trailing slash correctly when building URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    await fetchPathGuides('https://grafana.com/docs/learning-paths/linux-server-integration/');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://grafana.com/docs/learning-paths/linux-server-integration/index.json',
      { signal: undefined }
    );
  });

  it('handles URL without trailing slash', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    await fetchPathGuides('https://grafana.com/docs/learning-paths/linux-server-integration');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://grafana.com/docs/learning-paths/linux-server-integration/index.json',
      { signal: undefined }
    );
  });

  it('passes AbortSignal to fetch', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    const controller = new AbortController();
    await fetchPathGuides('https://grafana.com/docs/learning-paths/linux-server-integration/', controller.signal);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://grafana.com/docs/learning-paths/linux-server-integration/index.json',
      { signal: controller.signal }
    );
  });

  it('returns null when fetch is aborted', async () => {
    const abortError = new DOMException('Aborted', 'AbortError');
    mockFetch.mockRejectedValueOnce(abortError);

    const result = await fetchPathGuides('https://grafana.com/docs/learning-paths/linux-server-integration/');

    expect(result).toBeNull();
  });
});
