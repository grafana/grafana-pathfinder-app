import {
  achievementArtUrl,
  bestTier,
  findAchievement,
  tierRank,
  type AchievementDefinitions,
  type MyAchievementsResult,
} from '../../completion-records/achievements';

export interface EarnedTierView {
  id: string;
  label: string;
  artUrl: string | null;
}

export interface AchievementRowView {
  id: string;
  title: string;
  description: string;
  earned: EarnedTierView | null;
  /** Units toward the next tier, only where the data gives a next threshold and the achievement is earnable. */
  progress: { units: number; next: number } | null;
}

export type AchievementsView =
  | { kind: 'loading' }
  | { kind: 'hidden' }
  | { kind: 'definitions-unavailable' }
  | { kind: 'ready'; rows: AchievementRowView[]; truncated: boolean };

export function tierLabel(tierId: string): string {
  const spaced = tierId.replace(/-/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function tierView(definitions: AchievementDefinitions, achievementId: string, tierId: string): EarnedTierView {
  const tier = findAchievement(definitions, achievementId)?.tiers[tierRank(definitions, achievementId, tierId)];
  return { id: tierId, label: tierLabel(tierId), artUrl: achievementArtUrl(definitions.artBase, tier?.art) };
}

/** Earned achievements at their best tier, plus earnable ones with progress, in catalog order. */
export function buildAchievementsView(
  my: MyAchievementsResult,
  definitions: AchievementDefinitions | null
): AchievementsView {
  if (my.kind !== 'ok') {
    return { kind: 'hidden' };
  }
  if (!definitions) {
    return { kind: 'definitions-unavailable' };
  }
  const rows: AchievementRowView[] = [];
  for (const achievement of definitions.achievements) {
    const held = my.data.awards.filter((a) => a.achievementId === achievement.id).map((a) => a.tierId);
    const best = bestTier(definitions, achievement.id, held);
    const progress = my.data.progress.find((p) => p.achievementId === achievement.id);
    const towardNext =
      achievement.earnable && progress && progress.next !== null
        ? { units: progress.units, next: progress.next }
        : null;
    if (best === undefined && (towardNext === null || towardNext.units === 0)) {
      continue;
    }
    rows.push({
      id: achievement.id,
      title: achievement.title,
      description: achievement.description,
      earned: best === undefined ? null : tierView(definitions, achievement.id, best),
      progress: towardNext,
    });
  }
  return { kind: 'ready', rows, truncated: my.data.truncated };
}
