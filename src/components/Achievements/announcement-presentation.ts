import { t } from '@grafana/i18n';

import {
  achievementArtUrl,
  findAchievement,
  type AchievementAnnouncement,
  type AchievementDefinitions,
  type TierAnnouncement,
} from '../../completion-records/achievements';

import { tierView } from './achievements-view';

export interface AnnouncementCard {
  key: string;
  achievementId: string;
  kind: AchievementAnnouncement['kind'];
  eyebrow: string;
  title: string;
  /** The tier label, or the progress toward the next tier. */
  detail: string;
  artUrl: string | null;
  /** A tier-up gets the big overlay and no toast; a first award and progress get a toast. */
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
  if (announcement.kind === 'progress') {
    const nextTier = achievement.tiers.find((tier) => tier.at === announcement.next);
    return {
      key: `${announcement.achievementId}:progress`,
      achievementId: announcement.achievementId,
      kind: 'progress',
      eyebrow: t('achievements.announce.progress', 'Achievement progress'),
      title: achievement.title,
      detail: t('achievements.hub.progress', '{{units}} of {{next}} toward the next tier', {
        units: announcement.units,
        next: announcement.next,
      }),
      artUrl: achievementArtUrl(definitions.artBase, nextTier?.art),
      surface: 'toast',
    };
  }
  const tier = tierView(definitions, announcement.achievementId, announcement.tierId);
  return {
    key: `${announcement.achievementId}:${announcement.tierId}`,
    achievementId: announcement.achievementId,
    kind: announcement.kind,
    eyebrow: eyebrowFor(announcement),
    title: achievement.title,
    detail: tier.label,
    artUrl: tier.artUrl,
    surface: announcement.kind === 'tier_up' ? 'overlay' : 'toast',
  };
}

function eyebrowFor(announcement: TierAnnouncement): string {
  if (announcement.kind === 'award') {
    return t('achievements.announce.award', 'Achievement earned');
  }
  return announcement.final
    ? t('achievements.announce.final', 'Final tier reached')
    : t('achievements.announce.tierUp', 'Tier up');
}
