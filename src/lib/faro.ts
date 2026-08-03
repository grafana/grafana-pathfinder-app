// Compatibility barrel — implementation lives in ./telemetry/. New code
// should use the typed domain operations in ./telemetry instead.
export {
  guardTelemetry,
  initFaro,
  pauseFaroBeforeReload,
  pushFaroError,
  pushFaroLog,
  pushFaroUserAction,
  setFaroSessionAttributes,
  setFaroUserActionAttributes,
  setFaroView,
  setFaroViewName,
  stringifyAttributes,
  withFaroUserAction,
  USER_ACTION_TIMEOUT_LONG_MS,
  type FaroLogLevel,
  type WithFaroUserActionOptions,
} from './telemetry/faro-adapter';
export {
  buildResourceIgnorePattern,
  filterPathfinderTelemetry,
  getEnvironment,
  isGrafanaCloud,
  passesActivityGate,
} from './telemetry/filtering';
