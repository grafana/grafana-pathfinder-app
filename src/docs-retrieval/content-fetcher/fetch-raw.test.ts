import { fetchRawHtml, enforceHttps, generateUserFriendlyError } from './fetch-raw';
import { logger } from '../../lib/logging';

// Mock AbortSignal.timeout for Node environments that don't support it
if (!AbortSignal.timeout) {
  (AbortSignal as any).timeout = jest.fn((ms: number) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  });
}

const ORIGIN = 'https://grafana.com';
const DOC_URL = 'https://grafana.com/docs/grafana/latest/panels/';

const htmlResponse = (body: string, url: string) => {
  const headers = new Headers();
  headers.set('Content-Type', 'text/html; charset=utf-8');
  return { ok: true, status: 200, text: async () => body, url, headers };
};

const redirectResponse = (status: number, location: string | null) => {
  const headers = new Headers();
  if (location !== null) {
    headers.set('Location', location);
  }
  return { ok: false, status, statusText: 'Redirect', text: async () => '', url: '', headers };
};

beforeEach(() => {
  global.fetch = jest.fn();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// gap #1 — the manual 3xx redirect branch (most complex, untested before)
// ---------------------------------------------------------------------------
describe('fetchRawHtml — manual 3xx redirect handling', () => {
  it('follows a relative same-origin redirect to a trusted target and returns its content', async () => {
    const location = '/docs/grafana/latest/moved/';
    const redirectedUrl = `${ORIGIN}${location}`;
    (global.fetch as jest.Mock).mockImplementation((u: string) => {
      if (u === DOC_URL) {
        return Promise.resolve(redirectResponse(301, location));
      }
      // The followed redirect target serves the real content. Use a non-docs
      // path so the content.json ladder is not involved (the manual-redirect
      // branch returns the body directly).
      return Promise.resolve(htmlResponse('<html>moved content</html>', redirectedUrl));
    });

    const result = await fetchRawHtml(DOC_URL, {});

    expect(result.html).toBe('<html>moved content</html>');
    expect(result.finalUrl).toBe(redirectedUrl);
    expect(result.error).toBeUndefined();
  });

  it('does not follow an absolute (non-slash) redirect Location and surfaces the redirect error', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(redirectResponse(301, 'https://evil.com/phishing'));

    const result = await fetchRawHtml(DOC_URL, {});

    expect(result.html).toBeNull();
    expect(result.error?.message).toContain('Redirect to https://evil.com/phishing (status 301)');
    expect(result.error?.statusCode).toBe(301);
    // The redirect target was never fetched.
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('reports a 3xx response that carries no Location header', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(redirectResponse(302, null));

    const result = await fetchRawHtml(DOC_URL, {});

    expect(result.html).toBeNull();
    expect(result.error?.message).toBe('Redirect response (status 302) but no Location header');
    expect(result.error?.statusCode).toBe(302);
  });

  it('surfaces an error when following the redirect target throws', async () => {
    const location = '/docs/grafana/latest/moved/';
    (global.fetch as jest.Mock).mockImplementation((u: string) => {
      if (u === DOC_URL) {
        return Promise.resolve(redirectResponse(307, location));
      }
      return Promise.reject(new Error('boom while following redirect'));
    });

    const result = await fetchRawHtml(DOC_URL, {});

    expect(result.html).toBeNull();
    expect(result.error?.message).toBe('boom while following redirect');
  });

  it('retains the redirect error when the redirect target returns empty content', async () => {
    const location = '/docs/grafana/latest/moved/';
    (global.fetch as jest.Mock).mockImplementation((u: string) => {
      if (u === DOC_URL) {
        return Promise.resolve(redirectResponse(308, location));
      }
      return Promise.resolve(htmlResponse('   ', `${ORIGIN}${location}`));
    });

    const result = await fetchRawHtml(DOC_URL, {});

    expect(result.html).toBeNull();
    // Falls through with the original "Redirect to ..." error preserved.
    expect(result.error?.message).toContain('Redirect to /docs/grafana/latest/moved/ (status 308)');
  });
});

// ---------------------------------------------------------------------------
// trust + error mapping on the primary fetch
// ---------------------------------------------------------------------------
describe('fetchRawHtml — trust re-validation and error classification', () => {
  it('rejects when the ok response redirected to an untrusted final URL', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(htmlResponse('<html>x</html>', 'https://evil.com/x'));

    const result = await fetchRawHtml(DOC_URL, {});

    expect(result.html).toBeNull();
    expect(result.error?.message).toBe('Redirect target is not in trusted domain list');
  });

  it('classifies a 404 as not-found', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: new Headers(),
      text: async () => '',
    });

    const result = await fetchRawHtml(DOC_URL, {});
    expect(result.error?.errorType).toBe('not-found');
    expect(result.error?.statusCode).toBe(404);
  });

  it('classifies a 500 as server-error', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Server Error',
      headers: new Headers(),
      text: async () => '',
    });

    const result = await fetchRawHtml(DOC_URL, {});
    expect(result.error?.errorType).toBe('server-error');
  });

  it('classifies an aborted/timeout fetch as timeout', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('The operation was aborted due to timeout'));

    const result = await fetchRawHtml(DOC_URL, {});
    expect(result.error?.errorType).toBe('timeout');
  });

  it('classifies a network failure as network', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const result = await fetchRawHtml(DOC_URL, {});
    expect(result.error?.errorType).toBe('network');
  });
});

// ---------------------------------------------------------------------------
// telemetry log hygiene — URL redaction has one owner (normalizeTelemetryUrl)
// ---------------------------------------------------------------------------
describe('fetchRawHtml — telemetry log hygiene', () => {
  const SECRET_URL = 'https://grafana.com/docs/grafana/latest/panels/?token=secret123#fragment';

  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
  });

  const loggedMessages = () => [...warnSpy.mock.calls, ...errorSpy.mock.calls].map((call) => String(call[0]));

  it('keeps query and fragment out of log messages on HTTP errors and normalizes the context URL', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Server Error',
      headers: new Headers(),
      text: async () => '',
    });

    await fetchRawHtml(SECRET_URL, {});

    expect(loggedMessages().length).toBeGreaterThan(0);
    for (const message of loggedMessages()) {
      expect(message).not.toContain('token=secret123');
      expect(message).not.toContain('#fragment');
    }
    expect(warnSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ content_url: 'grafana.com/docs/grafana/latest/panels/' })
    );
  });

  it('keeps query and fragment out of log messages when the fetch throws', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await fetchRawHtml(SECRET_URL, {});

    expect(loggedMessages().length).toBeGreaterThan(0);
    for (const message of loggedMessages()) {
      expect(message).not.toContain('token=secret123');
      expect(message).not.toContain('#fragment');
    }
  });

  it('keeps the original URL out of the manual-redirect log message', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(redirectResponse(301, 'https://evil.com/phishing'));

    await fetchRawHtml(SECRET_URL, {});

    for (const message of loggedMessages()) {
      expect(message).not.toContain('token=secret123');
    }
    expect(warnSpy).toHaveBeenCalledWith(
      'Manual redirect detected',
      expect.objectContaining({ content_url: 'grafana.com/docs/grafana/latest/panels/' })
    );
  });
});

// ---------------------------------------------------------------------------
// enforceHttps — security gate
// ---------------------------------------------------------------------------
describe('enforceHttps', () => {
  it('accepts https URLs', () => {
    expect(enforceHttps('https://grafana.com/docs/')).toBe(true);
  });

  it('rejects http URLs (production)', () => {
    expect(enforceHttps('http://grafana.com/docs/')).toBe(false);
  });

  it('rejects malformed URLs', () => {
    expect(enforceHttps('not a url')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// generateUserFriendlyError — error mapping
// ---------------------------------------------------------------------------
describe('generateUserFriendlyError', () => {
  it('returns a generic message when no error is provided', () => {
    expect(generateUserFriendlyError(undefined, DOC_URL)).toContain('Failed to load content');
  });

  it.each([
    ['not-found', 'Document not found. It may have been moved or removed.'],
    ['timeout', 'Request timed out. Please check your internet connection and try again.'],
    ['network', 'Unable to connect. Please check your internet connection or try again later.'],
    ['server-error', 'Server error occurred. Please try again later.'],
  ] as const)('maps %s to its user-facing message', (errorType, expected) => {
    expect(generateUserFriendlyError({ message: 'raw', errorType }, DOC_URL)).toBe(expected);
  });

  it('falls back to the raw message for the default case', () => {
    expect(generateUserFriendlyError({ message: 'something specific', errorType: 'other' }, DOC_URL)).toBe(
      'something specific'
    );
  });
});
