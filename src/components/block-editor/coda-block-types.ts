import { useCodaTerminalGate } from '../../integrations/coda/useCodaAvailability.hook';
import type { BlockType } from './types';

/**
 * Block types that cannot do anything without `grafana-coda-app` behind them.
 *
 * `challenge` is absent on purpose: `mode: "standard"` runs against the user's
 * own Grafana with no VM, so the type stays useful without a sandbox.
 */
export const CODA_BLOCK_TYPES: BlockType[] = ['terminal', 'terminal-connect'];

/**
 * Whether the editor may offer a sandbox-backed block type.
 *
 * One predicate for creating a block and for converting one into it — a palette
 * that hides `terminal` while a type switch still produces one lets an author
 * build the block they were just told cannot exist here. `checking` counts as
 * unavailable: offering the type and withdrawing it a moment later is worse
 * than a brief absence.
 */
export function useCodaBlockTypesAvailable(): boolean {
  return useCodaTerminalGate() === 'configured';
}
