/**
 * useAssistantAvailability
 *
 * Thin wrapper over the Grafana Assistant availability observable that tracks
 * `isAssistantAvailable()` (or the dev-mode mock) and returns a boolean usable
 * in render logic.
 */

import { useEffect, useState } from 'react';
import { getIsAssistantAvailable } from './assistant-dev-mode';

export function useAssistantAvailability(): boolean {
  const [isAvailable, setIsAvailable] = useState(false);

  useEffect(() => {
    const subscription = getIsAssistantAvailable().subscribe((available: boolean) => {
      setIsAvailable(available);
    });
    return () => subscription.unsubscribe();
  }, []);

  return isAvailable;
}
