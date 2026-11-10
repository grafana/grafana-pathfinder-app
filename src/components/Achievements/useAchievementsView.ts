import { useEffect, useState } from 'react';

import {
  achievementsAvailability,
  loadAchievementDefinitions,
  loadMyAchievements,
  onAchievementsChanged,
} from '../../completion-records/achievements';
import { useBooleanFlag } from '../../utils/openfeature';

import { buildAchievementsView, settleAchievementsView, type AchievementsView } from './achievements-view';

export function useAchievementsView(): AchievementsView {
  const enabled = useBooleanFlag('pathfinder.achievements', false);
  const [view, setView] = useState<AchievementsView>({ kind: 'loading' });

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let cancelled = false;
    const settle = (next: AchievementsView) => {
      if (!cancelled) {
        setView((previous) => settleAchievementsView(previous, next, achievementsAvailability() === 'available'));
      }
    };
    const load = async () => {
      const my = await loadMyAchievements();
      const definitions = my.kind === 'ok' ? await loadAchievementDefinitions(my.data.definitionsVersion) : null;
      settle(buildAchievementsView(my, definitions));
    };
    void load().catch(() => settle(HIDDEN));
    const unsubscribe = onAchievementsChanged(() => void load().catch(() => undefined));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [enabled]);

  return enabled ? view : HIDDEN;
}

const HIDDEN: AchievementsView = { kind: 'hidden' };
