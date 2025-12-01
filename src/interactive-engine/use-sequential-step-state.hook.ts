import { useSyncExternalStore } from 'react';
import { RequirementsState, useRequirementsManager } from '../requirements-manager';

/**
 * React 18 hook for subscribing to SequentialRequirementsManager state
 * Uses useSyncExternalStore for proper external state synchronization
 *
 * This ensures React renders are synchronized with manager state updates,
 * eliminating race conditions in step sequencing.
 *
 * @param stepId - The unique identifier for the step to subscribe to
 * @returns The current state of the step, or undefined if not registered
 */
export function useSequentialStepState(stepId: string): RequirementsState | undefined {
  // Use context-based hook instead of singleton for better testability
  const { manager } = useRequirementsManager();

  return useSyncExternalStore(
    // Subscribe function - React will call this to set up the subscription
    (onStoreChange) => manager.subscribe(onStoreChange),

    // Client snapshot - returns current state for this step
    () => manager.getSnapshot().get(stepId),

    // Server snapshot (same as client for this use case)
    () => manager.getSnapshot().get(stepId)
  );
}
