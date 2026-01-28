/**
 * Coda Terminal Integration
 *
 * Provides an interactive terminal panel for the Pathfinder sidebar.
 * This is an experimental feature gated behind dev mode.
 */

export { TerminalPanel } from './TerminalPanel';
export { useTerminalLive } from './useTerminalLive.hook';
export type { ConnectionStatus } from './useTerminalLive.hook';
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
