import { t } from '@grafana/i18n';

import {
  findAchievement,
  type AchievementAnnouncement,
  type AchievementDefinitions,
} from '../../completion-records/achievements';

import { tierView, type EarnedTierView } from './achievements-view';

export interface AnnouncementCard {
  key: string;
  achievementId: string;
  eyebrow: string;
  title: string;
  tier: EarnedTierView;
  /** A tier-up gets the big overlay and no toast; a first award gets the toast. */
  surface: 'toast' | 'overlay';
}

export function presentAnnouncement(
  announcement: AchievementAnnouncement,
  definitions: AchievementDefinitions
): AnnouncementCard | null {
  const achievement = findAchievement(definitions, announcement.achievementId);
  if (!achievement) {
    return null;
  }
  return {
    key: `${announcement.achievementId}:${announcement.tierId}`,
    achievementId: announcement.achievementId,
    eyebrow: eyebrowFor(announcement),
    title: achievement.title,
    tier: tierView(definitions, announcement.achievementId, announcement.tierId),
    surface: announcement.kind === 'tier_up' ? 'overlay' : 'toast',
  };
}

function eyebrowFor(announcement: AchievementAnnouncement): string {
  if (announcement.kind === 'award') {
    return t('achievements.announce.award', 'Achievement earned');
  }
  return announcement.final
    ? t('achievements.announce.final', 'Final tier reached')
    : t('achievements.announce.tierUp', 'Tier up');
}
