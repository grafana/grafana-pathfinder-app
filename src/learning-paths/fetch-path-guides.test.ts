/**
 * Tests for fetchPathGuides
 *
 * Verifies that index.json is parsed correctly into guide IDs and metadata.
 * The actual HTTP transport is handled by fetchDocsIndexJson (backend proxy);
 * these tests mock that utility to focus on parsing and filtering logic.
 */

import { fetchPathGuides } from './fetch-path-guides';
import { fetchDocsIndexJson } from '../lib/fetch-docs-index';

jest.mock('../lib/fetch-docs-index');

const mockFetchDocsIndexJson = fetchDocsIndexJson as jest.MockedFunction<typeof fetchDocsIndexJson>;

beforeEach(() => {
  mockFetchDocsIndexJson.mockClear();
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
    mockFetchDocsIndexJson.mockResolvedValueOnce(SAMPLE_INDEX_JSON);

    const result = await fetchPathGuides('https://grafana.com/docs/learning-paths/linux-server-integration/');

    expect(mockFetchDocsIndexJson).toHaveBeenCalledWith(
      'https://grafana.com/docs/learning-paths/linux-server-integration/index.json',
      undefined
    );
    expect(result).not.toBeNull();
    expect(result!.guides).toEqual(['select-platform', 'install-alloy', 'configure-alloy']);
    expect(result!.guides).not.toContain('business-value');
  });

  it('filters out items with grafana.skip: true', async () => {
    mockFetchDocsIndexJson.mockResolvedValueOnce(SAMPLE_INDEX_JSON);

    const result = await fetchPathGuides('https://grafana.com/docs/learning-paths/linux-server-integration/');

    expect(result).not.toBeNull();
    expect(result!.guides).not.toContain('business-value');
    expect(result!.guideMetadata['business-value']).toBeUndefined();
  });

  it('uses menutitle over title when available', async () => {
    mockFetchDocsIndexJson.mockResolvedValueOnce(SAMPLE_INDEX_JSON);

    const result = await fetchPathGuides('https://grafana.com/docs/learning-paths/linux-server-integration/');

    expect(result).not.toBeNull();
    expect(result!.guideMetadata['select-platform']!.title).toBe('Select distribution');
    expect(result!.guideMetadata['configure-alloy']!.title).toBe(
      'Configure Grafana Alloy to use the Linux server integration'
    );
  });

  it('returns null when backend proxy returns null', async () => {
    mockFetchDocsIndexJson.mockResolvedValueOnce(null);

    const result = await fetchPathGuides('https://grafana.com/docs/learning-paths/nonexistent/');

    expect(result).toBeNull();
  });

  it('handles URL without trailing slash', async () => {
    mockFetchDocsIndexJson.mockResolvedValueOnce([]);

    await fetchPathGuides('https://grafana.com/docs/learning-paths/linux-server-integration');

    expect(mockFetchDocsIndexJson).toHaveBeenCalledWith(
      'https://grafana.com/docs/learning-paths/linux-server-integration/index.json',
      undefined
    );
  });

  it('passes AbortSignal through to fetchDocsIndexJson', async () => {
    mockFetchDocsIndexJson.mockResolvedValueOnce([]);

    const controller = new AbortController();
    await fetchPathGuides('https://grafana.com/docs/learning-paths/linux-server-integration/', controller.signal);

    expect(mockFetchDocsIndexJson).toHaveBeenCalledWith(
      'https://grafana.com/docs/learning-paths/linux-server-integration/index.json',
      controller.signal
    );
  });

  it('returns empty guides for an empty index.json array', async () => {
    mockFetchDocsIndexJson.mockResolvedValueOnce([]);

    const result = await fetchPathGuides('https://grafana.com/docs/learning-paths/linux-server-integration/');

    expect(result).not.toBeNull();
    expect(result!.guides).toEqual([]);
  });
});
