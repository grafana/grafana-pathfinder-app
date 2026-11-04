import React, { useState } from 'react';
import { SceneObjectBase, type SceneObjectState } from '@grafana/scenes';
import { LinkButton, useStyles2 } from '@grafana/ui';

import { ROUTES } from '../../constants';
import { BADGES, useLearningPaths } from '../../learning-paths';
import type { EarnedBadge } from '../../types';
import { prefixRoute } from '../../utils/utils.routing';
import { getHomePageStyles } from '../Home/home.styles';
import { SkeletonLoader } from '../SkeletonLoader';
import { BadgeDetailCard } from './BadgeDetailCard';
import { getBadgeProgress } from './badge-utils';
import { getMyLearningStyles } from './MyLearningTab.styles';
import { BadgesSection } from './sections/BadgesSection';

export class BadgesPanel extends SceneObjectBase<SceneObjectState> {
  public static Component = BadgesPanelRenderer;
}

function BadgesPanelRenderer() {
  const pageStyles = useStyles2(getHomePageStyles);
  const styles = useStyles2(getMyLearningStyles);
  const { badgesWithStatus, progress, paths, isLoading } = useLearningPaths();
  const [selectedBadge, setSelectedBadge] = useState<EarnedBadge | null>(null);
  const badges = [...badgesWithStatus].sort((a, b) => (b.earnedAt ?? 0) - (a.earnedAt ?? 0));
  const baseBadge = selectedBadge ? BADGES.find((badge) => badge.id === selectedBadge.id) : undefined;
  const selectedProgress = baseBadge
    ? getBadgeProgress(baseBadge, progress.completedGuides, progress.streakDays, paths)
    : null;

  return (
    <div className={pageStyles.browseLayout}>
      <nav aria-label="Learning pages" className={pageStyles.browseNavigation}>
        <LinkButton href={prefixRoute(ROUTES.Home)} variant="secondary" fill="text" size="md" icon="arrow-left">
          Back
        </LinkButton>
      </nav>
      <main className={pageStyles.badgesContent}>
        <h1>Badges</h1>
        {isLoading ? (
          <SkeletonLoader type="recommendations" />
        ) : (
          <BadgesSection
            compact
            gallery
            badges={badges}
            completedGuides={progress.completedGuides}
            streakDays={progress.streakDays}
            paths={paths}
            onSelect={setSelectedBadge}
            styles={styles}
          />
        )}
      </main>
      {selectedBadge && (
        <BadgeDetailCard badge={selectedBadge} progress={selectedProgress} onClose={() => setSelectedBadge(null)} />
      )}
    </div>
  );
}
