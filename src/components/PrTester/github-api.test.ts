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

    // Verify API was called with per_page=100 parameter
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/grafana/interactive-tutorials/pulls/70/files?per_page=100',
      expect.objectContaining({
        headers: expect.any(Object),
      })
    );
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

  it('should return forbidden error for 403 without rate limit on PR fetch', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 403,
      headers: {
        get: (name: string) => (name === 'X-RateLimit-Remaining' ? '50' : null), // Not rate limited
      },
    });

    const result = await fetchPrContentFiles('org', 'private-repo', 1);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('forbidden');
      expect(result.error.message).toContain('Access denied');
    }
  });

  it('should return forbidden error for 403 without rate limit on files fetch', async () => {
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
          get: (name: string) => (name === 'X-RateLimit-Remaining' ? '50' : null), // Not rate limited
        },
      });

    const result = await fetchPrContentFiles('org', 'repo', 1);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('forbidden');
      expect(result.error.message).toContain('Access denied');
    }
  });

  it('should return aborted error when request is cancelled', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';

    (global.fetch as jest.Mock).mockRejectedValueOnce(abortError);

    const result = await fetchPrContentFiles('org', 'repo', 1);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('aborted');
      expect(result.error.message).toBe('Request cancelled');
    }
  });

  it('should pass AbortSignal to fetch calls', async () => {
    const controller = new AbortController();
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

    await fetchPrContentFiles('org', 'repo', 1, controller.signal);

    // Verify signal was passed to both fetch calls
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      expect.objectContaining({ signal: controller.signal })
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.objectContaining({ signal: controller.signal })
    );
  });

  it('should return api_error when files response is not an array', async () => {
    const prMetadataResponse = { head: { sha: 'sha123' } };
    const malformedResponse = { error: 'something went wrong' }; // Not an array

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(prMetadataResponse),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(malformedResponse),
      });

    const result = await fetchPrContentFiles('org', 'repo', 1);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('api_error');
      expect(result.error.message).toContain('Unexpected API response format');
    }
  });

  it('should show warning when GitHub API limit is reached (100+ total files)', async () => {
    const prMetadataResponse = { head: { sha: 'sha123' } };
    // Simulate GitHub returning exactly 100 files (pagination limit)
    // Mixed content: 8 content.json files and 92 other files
    const filesResponse = [
      ...Array.from({ length: 8 }, (_, i) => ({
        filename: `guide-${i + 1}/content.json`,
        status: 'added',
      })),
      ...Array.from({ length: 92 }, (_, i) => ({
        filename: `src/file-${i + 1}.ts`,
        status: 'modified',
      })),
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

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.files).toHaveLength(8);
      expect(result.warning).toBeDefined();
      expect(result.warning).toContain('100+ files');
      expect(result.warning).toContain('Found 8 content.json');
      expect(result.warning).toContain('additional guides not shown');
    }
  });

  it('should not show warning when PR has fewer than 100 total files', async () => {
    const prMetadataResponse = { head: { sha: 'sha123' } };
    // PR with 50 total files, 8 are content.json
    const filesResponse = [
      ...Array.from({ length: 8 }, (_, i) => ({
        filename: `guide-${i + 1}/content.json`,
        status: 'added',
      })),
      ...Array.from({ length: 42 }, (_, i) => ({
        filename: `src/file-${i + 1}.ts`,
        status: 'modified',
      })),
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

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.files).toHaveLength(8);
      expect(result.warning).toBeUndefined();
    }
  });

  it('should handle PR with 100 total files all being content.json', async () => {
    const prMetadataResponse = { head: { sha: 'sha123' } };
    // Edge case: all 100 files are content.json
    const filesResponse = Array.from({ length: 100 }, (_, i) => ({
      filename: `guide-${i + 1}/content.json`,
      status: 'added',
    }));

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
      expect(result.files).toHaveLength(100);
      // Should show warning because we hit the GitHub API limit
      expect(result.warning).toBeDefined();
      expect(result.warning).toContain('100+ files');
    }
  });

  it('should handle PR with exactly 99 total files', async () => {
    const prMetadataResponse = { head: { sha: 'sha123' } };
    // Just under the pagination limit
    const filesResponse = [
      ...Array.from({ length: 10 }, (_, i) => ({
        filename: `guide-${i + 1}/content.json`,
        status: 'added',
      })),
      ...Array.from({ length: 89 }, (_, i) => ({
        filename: `src/file-${i + 1}.ts`,
        status: 'modified',
      })),
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

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.files).toHaveLength(10);
      expect(result.warning).toBeUndefined();
    }
  });

  it('should handle files with invalid filename gracefully', async () => {
    const prMetadataResponse = { head: { sha: 'sha123' } };
    const filesResponse = [
      { filename: 'valid/content.json', status: 'added' },
      { filename: null, status: 'added' }, // Invalid filename
      { status: 'added' }, // Missing filename
      { filename: 123, status: 'added' }, // Non-string filename
      { filename: 'another/content.json', status: 'modified' },
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

    expect(result.success).toBe(true);
    if (result.success) {
      // Only valid content.json files should be included
      expect(result.files).toHaveLength(2);
      expect(result.files[0].directoryName).toBe('valid');
      expect(result.files[1].directoryName).toBe('another');
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

  it('should forward AbortSignal to fetchPrContentFiles', async () => {
    const controller = new AbortController();
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

    await fetchPrContentFilesFromUrl('https://github.com/grafana/interactive-tutorials/pull/70', controller.signal);

    // Verify signal was passed through
    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: controller.signal })
    );
  });
});
