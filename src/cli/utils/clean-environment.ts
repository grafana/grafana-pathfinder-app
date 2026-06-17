/**
 * Lifecycle management for the isolated docker-compose stack used by `--clean`.
 *
 * `CleanEnvironment` owns the single "did we start the stack?" bit internally so
 * teardown ordering cannot be gotten wrong by callers: ownership is claimed
 * before `up -d`, so an interrupt mid-reset still tears the stack down.
 */

import { execSync, spawn } from 'child_process';

import { checkGrafanaHealth } from './grafana-health';

// Isolated docker-compose project vars used by --clean.
export const CLEAN_COMPOSE_PROJECT = 'pathfinder-e2e';
const CLEAN_COMPOSE_FILES = ['-f', 'docker-compose.yaml', '-f', 'docker-compose.e2e.yaml'];
const CLEAN_PROJECT_FLAGS = [...CLEAN_COMPOSE_FILES, '-p', CLEAN_COMPOSE_PROJECT];
// Must match `docker-compose.e2e.yaml` (services.grafana.ports → '3010:3000').
export const CLEAN_GRAFANA_URL = 'http://localhost:3010';

/**
 * Run a `docker compose` subcommand against the isolated --clean project and
 * resolve when it exits successfully.
 */
async function runDockerCompose(args: string[], options: { verbose: boolean }): Promise<void> {
  const fullArgs = ['compose', ...CLEAN_PROJECT_FLAGS, ...args];
  return new Promise((resolve, reject) => {
    if (options.verbose) {
      console.log(`   docker ${fullArgs.join(' ')}`);
    }
    const proc = spawn('docker', fullArgs, {
      stdio: options.verbose ? 'inherit' : ['ignore', 'ignore', 'inherit'],
    });
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`docker compose ${args.join(' ')} exited with code ${code}`));
      }
    });
    proc.on('error', (err) => {
      reject(new Error(`Failed to run docker compose: ${err.message}`));
    });
  });
}

/**
 * Poll Grafana health until it succeeds or `timeoutMs` elapses.
 */
async function waitForGrafanaReady(
  grafanaUrl: string,
  options: { verbose: boolean; timeoutMs: number }
): Promise<void> {
  const pollIntervalMs = 2000;
  const startTime = Date.now();
  let attempts = 0;
  let lastError = 'unknown error';

  while (Date.now() - startTime < options.timeoutMs) {
    attempts += 1;
    const health = await checkGrafanaHealth(grafanaUrl);
    if (health.passed) {
      if (options.verbose) {
        const elapsed = Date.now() - startTime;
        console.log(
          `   ✓ Grafana ready after ${attempts} attempt(s) in ${elapsed}ms (version ${health.version ?? 'unknown'})`
        );
      }
      return;
    }
    lastError = health.error ?? 'unknown error';
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  const seconds = Math.round(options.timeoutMs / 1000);
  throw new Error(`Grafana did not become ready within ${seconds}s: ${lastError}`);
}

/**
 * Synchronously tear down docker compose. Safe to call from `process.on('exit')`
 * and signal handlers since execSync blocks until completion.
 */
function teardownDockerSync(verbose: boolean): void {
  console.log(`\n🧹 Tearing down docker compose project ${CLEAN_COMPOSE_PROJECT} (down -v)...`);
  try {
    execSync(`docker compose ${CLEAN_PROJECT_FLAGS.join(' ')} down -v`, {
      stdio: verbose ? 'inherit' : ['ignore', 'ignore', 'inherit'],
    });
    console.log('   ✓ Teardown complete');
  } catch (err) {
    console.error(`   ⚠ Failed to tear down docker compose: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
}

/**
 * Owns the isolated `--clean` docker stack lifecycle and the single bit of state
 * (`startedByUs`) that decides whether teardown should run. The flag is private
 * so callers cannot reproduce the ordering bug where teardown is skipped after
 * an interrupt mid-reset.
 */
export class CleanEnvironment {
  private startedByUs = false;

  constructor(private readonly verbose: boolean) {}

  /**
   * Bring the isolated stack down (with volumes), back up, then wait for Grafana
   * to become healthy. Ownership is claimed before `up -d` so an interrupt
   * mid-reset still triggers teardown. Used by `--clean` to wipe the
   * `grafana-data` DB between dependency chains.
   */
  async reset(grafanaUrl: string, readyTimeoutMs: number): Promise<void> {
    this.startedByUs = true;

    console.log('   docker compose down -v');
    await runDockerCompose(['down', '-v'], { verbose: this.verbose });

    console.log('   docker compose up -d');
    await runDockerCompose(['up', '-d'], { verbose: this.verbose });

    console.log('   Waiting for Grafana to become healthy...');
    await waitForGrafanaReady(grafanaUrl, { verbose: this.verbose, timeoutMs: readyTimeoutMs });
    console.log('   ✓ Grafana ready');
  }

  /** Tear down the stack iff this process started it. Idempotent. */
  teardownIfOwned(): void {
    if (!this.startedByUs) {
      return;
    }
    this.startedByUs = false;
    teardownDockerSync(this.verbose);
  }
}
