import type {
  AchievementDefinitionsResponseWire,
  AchievementEventsResponseWire,
  MyAchievementsResponseWire,
} from '../../types/backend-api.schema';

export type AchievementDecision = AchievementEventsResponseWire['decisions'][number];
export type AchievementDefinitions = AchievementDefinitionsResponseWire;
export type AchievementDisplay = AchievementDefinitions['achievements'][number];
export type AchievementAward = MyAchievementsResponseWire['awards'][number];
export type HeldTier = Pick<AchievementAward, 'achievementId' | 'tierId'>;

export interface AchievementAnnouncement {
  achievementId: string;
  tierId: string;
  kind: 'award' | 'tier_up';
  final: boolean;
}

export function findAchievement(definitions: AchievementDefinitions, id: string): AchievementDisplay | undefined {
  return definitions.achievements.find((a) => a.id === id);
}

/** Catalog position of a tier, lowest first; -1 when the catalog does not list it. */
export function tierRank(definitions: AchievementDefinitions, achievementId: string, tierId: string): number {
  return findAchievement(definitions, achievementId)?.tiers.findIndex((t) => t.id === tierId) ?? -1;
}

/** The latest of `tierIds` in catalog order. Unknown ids rank below known ones, and among themselves keep wire order. */
export function bestTier(
  definitions: AchievementDefinitions,
  achievementId: string,
  tierIds: readonly string[]
): string | undefined {
  let best: string | undefined;
  let bestRank = -2;
  for (const tierId of tierIds) {
    const rank = tierRank(definitions, achievementId, tierId);
    if (rank >= bestRank) {
      best = tierId;
      bestRank = rank;
    }
  }
  return best;
}

/** The best newly held tier per achievement, and nothing when a higher tier of it is already held. */
export function selectAnnouncements(
  decisions: readonly AchievementDecision[],
  definitions: AchievementDefinitions,
  held: readonly HeldTier[]
): AchievementAnnouncement[] {
  const announcements: AchievementAnnouncement[] = [];
  for (const decision of decisions) {
    if ((decision.decision !== 'award' && decision.decision !== 'tier_up') || decision.awarded.length === 0) {
      continue;
    }
    const tierId = bestTier(definitions, decision.achievementId, decision.awarded);
    if (tierId === undefined) {
      continue;
    }
    const rank = tierRank(definitions, decision.achievementId, tierId);
    const outranked = held.some(
      (award) =>
        award.achievementId === decision.achievementId &&
        tierRank(definitions, award.achievementId, award.tierId) > rank
    );
    if (outranked) {
      continue;
    }
    announcements.push({
      achievementId: decision.achievementId,
      tierId,
      kind: decision.decision,
      final: decision.final,
    });
  }
  return announcements;
}
