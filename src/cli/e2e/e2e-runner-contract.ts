/**
 * Contract between the `pathfinder-cli e2e` command and the Playwright guide
 * runner it spawns. The CLI (`src/cli/commands/e2e.ts`) sets these environment
 * variables; the runner (`tests/e2e-runner/guide-runner.spec.ts`) and its
 * Playwright config (`tests/e2e-runner/playwright.config.ts`) read them.
 *
 * Both sides must reference these constants rather than literal strings so a
 * rename can never silently break the cross-process protocol.
 */

/**
 * Environment-variable keys exchanged between the CLI and the Playwright runner.
 * The property name is the role; the value is the wire key placed in `env`.
 */
export const E2E_ENV = {
  /** Absolute path to the guide JSON the runner should load. */
  GUIDE_JSON_PATH: 'GUIDE_JSON_PATH',
  /** Grafana base URL under test. */
  GRAFANA_URL: 'GRAFANA_URL',
  /**
   * Absolute path the form-login auth setup writes storage state to, and the
   * test project reads in non-token mode. Per-guide and ephemeral.
   */
  AUTH_STATE_FILE: 'AUTH_STATE_FILE',
  /** Username used by form-login auth setup. Defaults to admin. Not used in token mode. */
  GRAFANA_USER: 'GRAFANA_USER',
  /** Password used by form-login auth setup. Defaults to admin. Not used in token mode. */
  GRAFANA_PASSWORD: 'GRAFANA_PASSWORD',
  /**
   * Minted short-lived service-account token for a provisioned cloud target.
   * When set, the runner authenticates browser requests with an Authorization
   * header and skips form-login auth.
   */
  GRAFANA_TOKEN: 'GRAFANA_TOKEN',
  /** Flag: enable Playwright tracing. */
  TRACE: 'E2E_TRACE',
  /** Flag: enable verbose runner and reporter output. */
  VERBOSE: 'E2E_VERBOSE',
  /** Absolute path the runner writes its abort reason to (e.g. session expiry). */
  ABORT_FILE_PATH: 'ABORT_FILE_PATH',
  /** Absolute path the runner writes step results to for JSON reporting. */
  RESULTS_FILE_PATH: 'RESULTS_FILE_PATH',
  /** Directory the runner collects artifacts (screenshots, etc.) into. */
  ARTIFACTS_DIR: 'ARTIFACTS_DIR',
  /** Flag: capture screenshots on success as well as failure. */
  ALWAYS_SCREENSHOT: 'ALWAYS_SCREENSHOT',
  /**
   * Absolute path the runner writes the produced trace's location to, so the CLI
   * can surface it without hardcoding Playwright's per-test output-dir naming.
   */
  TRACE_OUTPUT_FILE: 'E2E_TRACE_OUTPUT_FILE',
} as const;

/** Encode a boolean for transport through a string environment variable. */
export function encodeEnvFlag(value: boolean): string {
  return value ? 'true' : 'false';
}

/** Decode an environment-variable flag written by {@link encodeEnvFlag}. */
export function isEnvFlagEnabled(value: string | undefined): boolean {
  return value === 'true';
}
