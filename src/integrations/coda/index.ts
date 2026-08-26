/**
 * Coda Terminal Integration
 *
 * Provides an interactive terminal panel for the Pathfinder sidebar. The VM and
 * SSH backend lives in the separate `grafana-coda-app` plugin; this integration
 * is a client of its versioned API. See that plugin's docs/API.md.
 */

export { TerminalPanel } from './TerminalPanel';
export { useTerminalLive } from './useTerminalLive.hook';
export type { ConnectionStatus, TerminalVMOptions } from './useTerminalLive.hook';
export {
  TerminalProvider,
  useTerminalContext,
  getTerminalConnectionStatus,
  getTerminalSessionId,
} from './TerminalContext';
export { CODA_PLUGIN_ID, getCapabilities } from './coda-api';
export type { CodaCapabilities } from './coda-api';
export { isCodaPluginAvailable, useCodaPluginAvailable } from './useCodaAvailability.hook';
export {
  getTerminalOpen,
  setTerminalOpen,
  getTerminalHeight,
  setTerminalHeight,
  clearTerminalStorage,
  DEFAULT_HEIGHT,
  MIN_HEIGHT,
  MAX_HEIGHT,
} from './terminal-storage';
