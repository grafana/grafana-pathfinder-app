import { dirname } from 'path';

import { loadManifestFromDir, parseVersion, runManifestPreflight } from './manifest-preflight';
import { checkGrafanaHealth } from './grafana-health';

export interface LocalCloudGuideTarget {
  id: string;
  sourcePath: string;
  targetUrl: string;
  token?: string;
}

async function fetchCloudVersion(targetUrl: string, token: string): Promise<string> {
  const target = new URL(targetUrl);
  if (target.protocol !== 'https:') {
    throw new Error('Cloud version lookup requires an HTTPS Grafana target.');
  }
  const settingsUrl = new URL('/api/frontend/settings', target);
  if (settingsUrl.origin !== target.origin) {
    throw new Error('Cloud version lookup must use the Grafana target origin.');
  }

  let response: Response;
  try {
    response = await fetch(settingsUrl, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new Error('Could not fetch Grafana version from /api/frontend/settings.');
  }
  if (!response.ok) {
    throw new Error(`Could not fetch Grafana version from /api/frontend/settings: HTTP ${response.status}.`);
  }

  let settings: unknown;
  try {
    settings = await response.json();
  } catch {
    throw new Error('Grafana /api/frontend/settings did not return valid JSON.');
  }
  const buildInfo =
    typeof settings === 'object' && settings !== null && 'buildInfo' in settings ? settings.buildInfo : null;
  const version =
    typeof buildInfo === 'object' && buildInfo !== null && 'version' in buildInfo ? buildInfo.version : null;
  if (typeof version !== 'string' || !parseVersion(version)) {
    throw new Error('Grafana /api/frontend/settings did not return a valid buildInfo.version.');
  }
  return version;
}

export async function preflightLocalCloudGuides(guides: LocalCloudGuideTarget[]): Promise<void> {
  for (const guide of guides) {
    const manifest = loadManifestFromDir(dirname(guide.sourcePath));
    if (!manifest || manifest.id !== guide.id) {
      throw new Error(`Local package manifest is missing or does not match guide "${guide.id}".`);
    }
    if (manifest.testEnvironment?.tier !== 'cloud') {
      throw new Error(`Local cloud source package "${guide.id}" is not declared cloud-tier.`);
    }
    if (!guide.token) {
      throw new Error(`Cloud target credential is unavailable for ${guide.id}.`);
    }
    const health = await checkGrafanaHealth(guide.targetUrl);
    if (!health.passed) {
      throw new Error(`Pre-flight check failed for ${guide.id} at ${guide.targetUrl}: ${health.error}`);
    }
    let cloudVersion: string | undefined;
    if (manifest.testEnvironment.minVersion !== undefined) {
      if (!manifest.testEnvironment.minVersion.trim()) {
        throw new Error(`Manifest pre-flight failed for ${guide.id}: minVersion must not be empty.`);
      }
      try {
        cloudVersion = await fetchCloudVersion(guide.targetUrl, guide.token);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Cloud version lookup failed.';
        throw new Error(`Manifest pre-flight failed for ${guide.id}: minVersion: ${message}`);
      }
    }
    const outcome = await runManifestPreflight(manifest, {
      grafanaUrl: guide.targetUrl,
      currentTier: 'cloud',
      grafanaVersion: cloudVersion,
      token: guide.token,
    });
    if (!outcome.canRun) {
      const failures = outcome.results.flatMap((result) =>
        result.status === 'fail' ? [`${result.check}: ${result.message}`] : []
      );
      throw new Error(`Manifest pre-flight failed for ${guide.id}: ${failures.join('; ')}`);
    }
  }
}
