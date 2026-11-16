import React, { useRef, useState } from 'react';
import { SceneObjectBase, type SceneObjectState } from '@grafana/scenes';
import { Button, useStyles2 } from '@grafana/ui';
import { locationService } from '@grafana/runtime';
import { t } from '@grafana/i18n';

import { ROUTES } from '../../constants';
import { useLearningPageScroll } from '../../hooks';
import { BADGES, useLearningPaths } from '../../learning-paths';
import type { EarnedBadge } from '../../types';
import { prefixRoute } from '../../utils/utils.routing';
import { getHomePageStyles } from '../Home/home.styles';
import { getPackageBrowserStyles } from '../PackageBrowser/package-browser.styles';
import { SkeletonLoader } from '../SkeletonLoader';
import { BadgeDetailCard } from './BadgeDetailCard';
import { getBadgeProgress } from './badge-utils';
import { getMyLearningStyles } from './MyLearningTab.styles';
import { BadgesSection } from './sections/BadgesSection';

export class BadgesPanel extends SceneObjectBase<SceneObjectState> {
  public static Component = BadgesPanelRenderer;
}

function BadgesPanelRenderer() {
  const container = useRef<HTMLDivElement>(null);
  useLearningPageScroll(container);
  const pageStyles = useStyles2(getHomePageStyles);
  const exploreStyles = useStyles2(getPackageBrowserStyles);
  const styles = useStyles2(getMyLearningStyles);
  const { badgesWithStatus, progress, paths, isLoading } = useLearningPaths();
  const [selectedBadge, setSelectedBadge] = useState<EarnedBadge | null>(null);
  const badges = [...badgesWithStatus].sort((a, b) => (b.earnedAt ?? 0) - (a.earnedAt ?? 0));
  const baseBadge = selectedBadge ? BADGES.find((badge) => badge.id === selectedBadge.id) : undefined;
  const selectedProgress = baseBadge
    ? getBadgeProgress(baseBadge, progress.completedGuides, progress.streakDays, paths)
    : null;

  return (
    <div ref={container} className={pageStyles.browseLayout}>
      <nav aria-label={t('myLearning.pageActions', 'Learning pages')} className={pageStyles.browseNavigation}>
        <Button
          onClick={() => locationService.push(prefixRoute(ROUTES.Home))}
          variant="secondary"
          fill="text"
          size="md"
          icon="arrow-left"
        >
          {t('common.back', 'Back')}
        </Button>
      </nav>
      <main className={exploreStyles.pageContainer}>
        <div className={exploreStyles.inner}>
          <div className={exploreStyles.header}>
            <div>
              <h1>{t('myLearning.yourBadges', 'Your badges')}</h1>
              <p className={exploreStyles.description}>
                {t('myLearning.badgesDescription', 'Earn badges as you complete guides and learning paths.')}
              </p>
            </div>
          </div>
          {isLoading ? (
            <SkeletonLoader type="recommendations" />
          ) : (
            <BadgesSection
              compact
              gallery
              badges={badges}
              selectedBadgeId={selectedBadge?.id}
              completedGuides={progress.completedGuides}
              streakDays={progress.streakDays}
              paths={paths}
              onSelect={setSelectedBadge}
              styles={styles}
            />
          )}
        </div>
      </main>
      {selectedBadge && (
        <BadgeDetailCard badge={selectedBadge} progress={selectedProgress} onClose={() => setSelectedBadge(null)} />
      )}
    </div>
  );
}
