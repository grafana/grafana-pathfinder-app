/**
 * Terminal connection check: `is-terminal-active`.
 *
 * Reads the Coda terminal status via dynamic import to avoid pulling the
 * integration into bundles that don't use it (and to break a circular
 * dependency between requirements-manager and integrations/coda).
 */

import type { CheckResultError } from '../requirements-checker.utils';

export async function terminalActiveCheck(check: string): Promise<CheckResultError> {
  try {
    const { getTerminalConnectionStatus } = await import('../../integrations/coda/TerminalContext');
    const status = getTerminalConnectionStatus();
    const isConnected = status === 'connected';
    return {
      requirement: check,
      pass: isConnected,
      error: isConnected ? undefined : 'Terminal is not connected. Connect to a terminal session to continue.',
      context: { terminalStatus: status },
    };
  } catch {
    return {
      requirement: check,
      pass: false,
      error: 'Terminal integration is not available.',
      context: null,
    };
  }
}
