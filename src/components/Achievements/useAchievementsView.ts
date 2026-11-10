import { useEffect, useState } from 'react';

import {
  loadAchievementDefinitions,
  loadMyAchievements,
  onAchievementsChanged,
} from '../../completion-records/achievements';
import { useBooleanFlag } from '../../utils/openfeature';

import { buildAchievementsView, type AchievementsView } from './achievements-view';

export function useAchievementsView(): AchievementsView {
  const enabled = useBooleanFlag('pathfinder.achievements', false);
  const [view, setView] = useState<AchievementsView>({ kind: 'loading' });

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let cancelled = false;
    const load = async () => {
      const my = await loadMyAchievements();
      const definitions = my.kind === 'ok' ? await loadAchievementDefinitions(my.data.definitionsVersion) : null;
      if (!cancelled) {
        setView(buildAchievementsView(my, definitions));
      }
    };
    void load().catch(() => !cancelled && setView({ kind: 'hidden' }));
    const unsubscribe = onAchievementsChanged(() => void load().catch(() => undefined));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [enabled]);

  return enabled ? view : HIDDEN;
}

const HIDDEN: AchievementsView = { kind: 'hidden' };
