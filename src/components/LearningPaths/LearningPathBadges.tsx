import React, { useEffect, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { t } from '@grafana/i18n';
import { useStyles2 } from '@grafana/ui';

import { getCourseCompletionBadges } from '../../learning-paths';
import { StorageEvents } from '../../lib/event-names';
import { getMilestoneSlug } from '../../lib/learning-journey-url';
import { learningProgressStorage } from '../../lib/user-storage';
import type { Milestone } from '../../types/content.types';
import type { LearningProgress } from '../../types/learning-paths.types';
import { BadgeDetailCard } from './BadgeDetailCard';
import { BadgeGridItem } from './BadgeGridItem';
import { getMyLearningStyles } from './MyLearningTab.styles';
import { getBadgeProgress } from './badge-utils';

interface LearningPathBadgePath {
  pathId?: string;
  baseUrl: string;
  organization?: boolean;
  milestones: Milestone[];
}

export function LearningPathBadges({ path, nested }: { path: LearningPathBadgePath; nested: boolean }) {
  const styles = useStyles2(getStyles);
  const badgeStyles = useStyles2(getMyLearningStyles);
  const badges = getCourseCompletionBadges(path);
  const hasBadges = badges.length > 0;
  const [learningProgress, setLearningProgress] = useState<LearningProgress | null>(null);
  const [selectedBadgeId, setSelectedBadgeId] = useState<string | null>(null);

  useEffect(() => {
    if (!hasBadges) {
      return;
    }
    let mounted = true;
    let revision = 0;
    const loadEarnedBadges = async () => {
      const currentRevision = ++revision;
      const progress = await learningProgressStorage.get();
      if (mounted && currentRevision === revision) {
        setLearningProgress(progress ?? null);
      }
    };
    const handleProgressUpdate = () => void loadEarnedBadges();
    window.addEventListener(StorageEvents.LearningProgressUpdated, handleProgressUpdate);
    void loadEarnedBadges();
    return () => {
      mounted = false;
      window.removeEventListener(StorageEvents.LearningProgressUpdated, handleProgressUpdate);
    };
  }, [hasBadges]);

  if (!hasBadges) {
    return null;
  }

  const earnedBadges = badges.map((badge) => ({
    ...badge,
    earnedAt: learningProgress?.earnedBadges.find(({ id }) => id === badge.id)?.earnedAt,
  }));
  const selectedBadge = earnedBadges.find(({ id }) => id === selectedBadgeId);
  const guides = path.milestones.map((milestone) => milestone.id ?? getMilestoneSlug(milestone.url));
  const badgePaths = badges.flatMap(({ trigger }) =>
    trigger.type === 'path-completed' ? [{ id: trigger.pathId, guides }] : []
  );
  const completedGuides = learningProgress?.completedGuides ?? [];
  const streakDays = learningProgress?.streakDays ?? 0;
  const progress = selectedBadge ? getBadgeProgress(selectedBadge, completedGuides, streakDays, badgePaths) : null;
  const Heading = nested ? 'h3' : 'h2';
  return (
    <div className={styles.section}>
      <Heading>{t('coverPage.earnableBadges', 'Badges you can earn')}</Heading>
      <div className={badgeStyles.homeBadgeGroup}>
        {earnedBadges.map((badge, index) => (
          <BadgeGridItem
            key={badge.id}
            summary
            badge={badge}
            index={index}
            selected={selectedBadgeId === badge.id}
            completedGuides={completedGuides}
            streakDays={streakDays}
            paths={badgePaths}
            styles={badgeStyles}
            onSelect={(selected) => setSelectedBadgeId(selected.id)}
          />
        ))}
      </div>
      {selectedBadge && (
        <BadgeDetailCard badge={selectedBadge} progress={progress} onClose={() => setSelectedBadgeId(null)} />
      )}
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  section: css({
    '&& > h2': { fontSize: theme.typography.xl.fontSize, marginTop: 0 },
  }),
});
