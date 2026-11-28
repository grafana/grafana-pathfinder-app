import { createExperiments } from '@grafana-experiments/sdk';

import { getPathfinderFaro } from './faro-adapter';

export function isExperimentTelemetryAvailable(): boolean {
  return getPathfinderFaro() !== null;
}

export function createPathfinderExperiments(options: Omit<Parameters<typeof createExperiments>[0], 'faro'>) {
  const instance = getPathfinderFaro();
  return instance ? createExperiments({ ...options, faro: { instance } }) : null;
}
