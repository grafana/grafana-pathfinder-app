import { firstValueFrom, timeout } from 'rxjs';
import { config, getBackendSrv } from '@grafana/runtime';
import { compareVersions, parseVersion } from './guide-version';

let healthyNamespace: string | undefined;

export function usesSdkBackend(): boolean {
  return healthyNamespace !== undefined && config.namespace === healthyNamespace;
}

export const backendPaths = [
  'pathfinder-settings',
  'custom-guide',
  'custom-guide-repository',
  'completion-records',
  'completion-records/my',
  'completion-records/capability',
  'assignments/my',
  'learning-insights',
  'package-recommendations',
  'private-cdn/identity',
  'private-cdn/catalogue',
  'private-cdn/sign',
  'health',
  'api/v1/achievements/events',
  'api/v1/achievements/my',
  'api/v1/achievements/definitions',
] as const;

export function backendRoute(path: (typeof backendPaths)[number]): string {
  if (!(backendPaths as readonly string[]).includes(path)) {
    throw new Error('Unknown backend route');
  }
  if (!config?.namespace || config.namespace === '*') {
    throw new Error('SDK backend namespace is unavailable');
  }
  return `/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/${encodeURIComponent(config.namespace)}/backend/${path}`;
}

function shouldProbeSdkBackend(): boolean {
  const namespace = config.namespace;
  const toggles = config.featureToggles as Record<string, boolean> | undefined;
  return Boolean(
    namespace &&
    namespace !== '*' &&
    (/^stacks-[0-9]+$/.test(namespace) ||
      (toggles?.['appplugins.loadAppManifest'] === true && toggles?.['appplugins.registerAPIServer'] === true))
  );
}

let unsupportedNamespace: string | undefined;

export function expectsSdkBackend(): boolean {
  return usesSdkBackend() || (shouldProbeSdkBackend() && unsupportedNamespace !== config.namespace);
}

let probe: { namespace: string; result: Promise<void> } | undefined;
let retryAfter: { namespace: string; at: number } | undefined;

export async function recoverSdkBackend(): Promise<boolean> {
  if (
    !usesSdkBackend() &&
    shouldProbeSdkBackend() &&
    !(retryAfter?.namespace === config.namespace && retryAfter.at > Date.now())
  ) {
    await discoverSdkBackend();
  }
  return usesSdkBackend();
}

export async function discoverSdkBackend(): Promise<void> {
  const namespace = config.namespace;
  if (!shouldProbeSdkBackend() || usesSdkBackend()) {
    return;
  }
  if (probe?.namespace === namespace) {
    return probe.result;
  }
  const result = probeNamespace(namespace);
  probe = { namespace, result };
  try {
    await result;
  } finally {
    if (probe?.result === result) {
      probe = undefined;
    }
  }
}

async function probeNamespace(namespace: string): Promise<void> {
  try {
    const response = await firstValueFrom(
      getBackendSrv()
        .fetch<{ status: string }>({ url: backendRoute('health'), showErrorAlert: false })
        .pipe(timeout(2000))
    );
    if (response.data?.status === 'ok' && config.namespace === namespace) {
      unsupportedNamespace = undefined;
      healthyNamespace = namespace;
    }
  } catch (error) {
    if (config.namespace === namespace) {
      const version = parseVersion(config.buildInfo?.version ?? '');
      const olderHost = version && compareVersions(version, [13, 3, 0]) < 0;
      const missingRoute = (error as { status?: number } | null)?.status === 404;
      if (olderHost && missingRoute && !/^stacks-[0-9]+$/.test(namespace)) {
        unsupportedNamespace = namespace;
      }
    }
  }
  if (config.namespace === namespace && !usesSdkBackend()) {
    retryAfter = { namespace, at: Date.now() + 5000 };
  }
}
