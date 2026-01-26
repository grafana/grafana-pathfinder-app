/**
 * Tests for GitHub API utilities used by PR Tester
 */
import { parsePrUrl, isValidPrUrl, fetchPrContentFiles, fetchPrContentFilesFromUrl } from './github-api';

describe('parsePrUrl', () => {
  describe('valid PR URLs', () => {
    it('should parse standard GitHub PR URLs', () => {
      const result = parsePrUrl('https://github.com/grafana/interactive-tutorials/pull/70');
      expect(result).toEqual({
        owner: 'grafana',
        repo: 'interactive-tutorials',
        prNumber: 70,
      });
    });

    it('should parse URLs with different owners and repos', () => {
      const result = parsePrUrl('https://github.com/facebook/react/pull/12345');
      expect(result).toEqual({
        owner: 'facebook',
        repo: 'react',
        prNumber: 12345,
      });
    });

    it('should parse URLs with trailing paths', () => {
      const result = parsePrUrl('https://github.com/org/repo/pull/99/files');
      expect(result).toEqual({
        owner: 'org',
        repo: 'repo',
        prNumber: 99,
      });
    });

    it('should parse URLs with query params', () => {
      const result = parsePrUrl('https://github.com/org/repo/pull/1?diff=split');
      expect(result).toEqual({
        owner: 'org',
        repo: 'repo',
        prNumber: 1,
      });
    });

    it('should parse URLs with hashes', () => {
      const result = parsePrUrl('https://github.com/org/repo/pull/42#discussion_r123');
      expect(result).toEqual({
        owner: 'org',
        repo: 'repo',
        prNumber: 42,
      });
    });

    it('should parse URLs with www subdomain', () => {
      const result = parsePrUrl('https://www.github.com/org/repo/pull/5');
      expect(result).toEqual({
        owner: 'org',
        repo: 'repo',
        prNumber: 5,
      });
    });

    it('should handle repos with hyphens and underscores', () => {
      const result = parsePrUrl('https://github.com/my-org/my_repo-name/pull/100');
      expect(result).toEqual({
        owner: 'my-org',
        repo: 'my_repo-name',
        prNumber: 100,
      });
    });
  });

  describe('invalid PR URLs', () => {
    it('should return null for non-GitHub URLs', () => {
      expect(parsePrUrl('https://gitlab.com/org/repo/pull/1')).toBeNull();
      expect(parsePrUrl('https://bitbucket.org/org/repo/pull/1')).toBeNull();
    });

    it('should return null for non-PR GitHub URLs', () => {
      expect(parsePrUrl('https://github.com/grafana/grafana')).toBeNull();
      expect(parsePrUrl('https://github.com/grafana/grafana/issues/123')).toBeNull();
      expect(parsePrUrl('https://github.com/grafana/grafana/blob/main/README.md')).toBeNull();
    });

    it('should return null for malformed PR URLs', () => {
      expect(parsePrUrl('https://github.com/grafana/grafana/pull/')).toBeNull();
      expect(parsePrUrl('https://github.com/grafana/grafana/pull/abc')).toBeNull();
      expect(parsePrUrl('https://github.com//pull/123')).toBeNull();
    });

    it('should return null for empty or invalid input', () => {
      expect(parsePrUrl('')).toBeNull();
      expect(parsePrUrl('not a url')).toBeNull();
    });

    it('should parse URLs without protocol (permissive for dev tool)', () => {
      // Dev tool is permissive - URLs without protocol are still parsed
      const result = parsePrUrl('github.com/org/repo/pull/1');
      expect(result).toEqual({
        owner: 'org',
        repo: 'repo',
        prNumber: 1,
      });
    });

    it('should return null for PR number 0 or negative', () => {
      expect(parsePrUrl('https://github.com/org/repo/pull/0')).toBeNull();
      expect(parsePrUrl('https://github.com/org/repo/pull/-1')).toBeNull();
    });
  });
});

describe('isValidPrUrl', () => {
  it('should return true for valid PR URLs', () => {
    expect(isValidPrUrl('https://github.com/grafana/interactive-tutorials/pull/70')).toBe(true);
    expect(isValidPrUrl('https://github.com/org/repo/pull/1')).toBe(true);
  });

  it('should return false for invalid PR URLs', () => {
    expect(isValidPrUrl('')).toBe(false);
    expect(isValidPrUrl('not a url')).toBe(false);
    expect(isValidPrUrl('https://github.com/org/repo')).toBe(false);
    expect(isValidPrUrl('https://gitlab.com/org/repo/pull/1')).toBe(false);
  });
});

describe('fetchPrContentFiles', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should fetch and filter content.json files from a PR', async () => {
    // Mock PR metadata response
    const prMetadataResponse = {
      head: { sha: 'abc123def456' },
    };

    // Mock PR files response
    const filesResponse = [
      { filename: 'guide-one/content.json', status: 'added' },
      { filename: 'guide-two/content.json', status: 'modified' },
      { filename: 'other/file.ts', status: 'added' },
      { filename: 'README.md', status: 'modified' },
    ];

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(prMetadataResponse),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(filesResponse),
      });

    const result = await fetchPrContentFiles('grafana', 'interactive-tutorials', 70);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.files).toHaveLength(2);
      expect(result.files[0]).toEqual({
        directoryName: 'guide-one',
        rawUrl: 'https://raw.githubusercontent.com/grafana/interactive-tutorials/abc123def456/guide-one/content.json',
        status: 'added',
      });
      expect(result.files[1]).toEqual({
        directoryName: 'guide-two',
        rawUrl: 'https://raw.githubusercontent.com/grafana/interactive-tutorials/abc123def456/guide-two/content.json',
        status: 'modified',
      });
    }
  });

  it('should handle nested content.json paths', async () => {
    const prMetadataResponse = { head: { sha: 'sha123' } };
    const filesResponse = [{ filename: 'category/subcategory/guide/content.json', status: 'added' }];

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(prMetadataResponse),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(filesResponse),
      });

    const result = await fetchPrContentFiles('org', 'repo', 1);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.files[0].directoryName).toBe('category/subcategory/guide');
    }
  });

  it('should return no_files error when no content.json found', async () => {
    const prMetadataResponse = { head: { sha: 'sha123' } };
    const filesResponse = [
      { filename: 'README.md', status: 'modified' },
      { filename: 'package.json', status: 'modified' },
    ];

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(prMetadataResponse),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(filesResponse),
      });

    const result = await fetchPrContentFiles('org', 'repo', 1);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('no_files');
      expect(result.error.message).toContain('No content.json files found');
    }
  });

  it('should return not_found error for 404 response', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 404,
    });

    const result = await fetchPrContentFiles('org', 'nonexistent', 999);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('not_found');
      expect(result.error.message).toContain('PR not found');
    }
  });

  it('should return rate_limited error when rate limit exceeded on PR fetch', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 403,
      headers: {
        get: (name: string) => (name === 'X-RateLimit-Remaining' ? '0' : null),
      },
    });

    const result = await fetchPrContentFiles('org', 'repo', 1);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('rate_limited');
      expect(result.error.message).toContain('rate limit exceeded');
    }
  });

  it('should return rate_limited error when rate limit exceeded on files fetch', async () => {
    const prMetadataResponse = { head: { sha: 'sha123' } };

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(prMetadataResponse),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: {
          get: (name: string) => (name === 'X-RateLimit-Remaining' ? '0' : null),
        },
      });

    const result = await fetchPrContentFiles('org', 'repo', 1);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('rate_limited');
    }
  });

  it('should return api_error for other HTTP errors', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    const result = await fetchPrContentFiles('org', 'repo', 1);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('api_error');
      expect(result.error.message).toContain('500');
    }
  });

  it('should return network_error for fetch failures', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network failure'));

    const result = await fetchPrContentFiles('org', 'repo', 1);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('network_error');
      expect(result.error.message).toContain('Network error');
    }
  });

  it('should return api_error when head SHA is missing', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}), // No head.sha
    });

    const result = await fetchPrContentFiles('org', 'repo', 1);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('api_error');
      expect(result.error.message).toContain('head SHA');
    }
  });
});

describe('fetchPrContentFilesFromUrl', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should return invalid_url error for invalid PR URLs', async () => {
    const result = await fetchPrContentFilesFromUrl('not a valid url');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('invalid_url');
      expect(result.error.message).toContain('Invalid PR URL');
    }
  });

  it('should parse URL and fetch files for valid PR URLs', async () => {
    const prMetadataResponse = { head: { sha: 'sha123' } };
    const filesResponse = [{ filename: 'guide/content.json', status: 'added' }];

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(prMetadataResponse),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(filesResponse),
      });

    const result = await fetchPrContentFilesFromUrl('https://github.com/grafana/interactive-tutorials/pull/70');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.files).toHaveLength(1);
    }

    // Verify the API was called with correct parameters
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/grafana/interactive-tutorials/pulls/70',
      expect.any(Object)
    );
  });
});
