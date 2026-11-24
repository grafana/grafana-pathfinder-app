import { useEffect, useState } from 'react';

import {
  achievementsAvailability,
  onAchievementsAvailabilityChanged,
  probeAchievementsAvailability,
} from '../../completion-records/achievements';
import { useBooleanFlag } from '../../utils/openfeature';

/** True once achievements are confirmed available (flag on, `/my` capability available); until then legacy stays. */
export function useLegacyBadgesHidden(): boolean {
  const enabled = useBooleanFlag('pathfinder.achievements', false);
  const [available, setAvailable] = useState(() => achievementsAvailability() === 'available');

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const sync = () => setAvailable(achievementsAvailability() === 'available');
    const unsubscribe = onAchievementsAvailabilityChanged(sync);
    sync();
    probeAchievementsAvailability();
    return unsubscribe;
  }, [enabled]);

  return enabled && available;
}
