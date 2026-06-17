/**
 * Grafana health probing for the e2e CLI. Used by the CLI pre-flight check and
 * by the --clean docker reset, which polls until a freshly started instance is
 * healthy.
 */

/**
 * Result of a CLI-level Grafana health check.
 */
export interface CliPreflightResult {
  passed: boolean;
  error?: string;
  durationMs: number;
  /** Grafana version from /api/health — passed to manifest pre-flight to avoid a duplicate fetch. */
  version?: string;
}

/**
 * Check if Grafana is reachable and healthy.
 *
 * This is a public endpoint that doesn't require authentication,
 * so it can be called from the CLI before spawning Playwright.
 */
export async function checkGrafanaHealth(grafanaUrl: string): Promise<CliPreflightResult> {
  const startTime = Date.now();

  try {
    const healthUrl = new URL('/api/health', grafanaUrl).toString();
    const response = await fetch(healthUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      // Short timeout for health check
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return {
        passed: false,
        error: `Grafana health check failed: HTTP ${response.status} ${response.statusText}`,
        durationMs: Date.now() - startTime,
      };
    }

    const data = (await response.json()) as { database?: string; version?: string };

    // Verify database is healthy
    if (data.database !== 'ok') {
      return {
        passed: false,
        error: `Grafana database not healthy: ${data.database ?? 'unknown'}`,
        durationMs: Date.now() - startTime,
      };
    }

    return {
      passed: true,
      durationMs: Date.now() - startTime,
      version: data.version,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.name === 'TimeoutError'
          ? `Connection timeout after 10s`
          : error.message
        : 'Unknown error';

    return {
      passed: false,
      error: `Grafana not reachable at ${grafanaUrl}: ${errorMessage}`,
      durationMs: Date.now() - startTime,
    };
  }
}
