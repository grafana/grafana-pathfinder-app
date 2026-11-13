import { config } from '@grafana/runtime';
import { PLUGIN_BACKEND_URL } from '../constants';

export function usesSdkBackend(): boolean {
  const toggles = config?.featureToggles as Record<string, boolean> | undefined;
  return (
    Boolean(config?.namespace) &&
    toggles?.['appplugins.loadAppManifest'] === true &&
    toggles?.['appplugins.registerAPIServer'] === true
  );
}

const backendPaths = [
  'pathfinder-settings',
  'custom-guide',
  'custom-guides',
  'custom-guide-repository',
  'completion-records',
  'completion-records/my',
  'completion-records/capability',
  'assignments/my',
  'learning-insights',
  'package-recommendations',
  'health',
] as const;

export function backendRoute(path: (typeof backendPaths)[number]): string {
  if (!(backendPaths as readonly string[]).includes(path)) {
    throw new Error('Unknown backend route');
  }
  if (!usesSdkBackend()) {
    return `${PLUGIN_BACKEND_URL}/${path}`;
  }
  return `/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/${encodeURIComponent(config.namespace)}/backend/${path}`;
}
