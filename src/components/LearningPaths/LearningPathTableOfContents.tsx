import React, { useEffect, useState } from 'react';
import { useStyles2, Icon } from '@grafana/ui';
import { t } from '@grafana/i18n';

import type { Milestone } from '../../types/content.types';
import type { PathGuide } from '../../types/learning-paths.types';
import { milestoneCompletionStorage } from '../../lib/user-storage';
import { getMilestoneSlug } from '../../lib/learning-journey-url';
import { testIds } from '../../constants/testIds';
import { getBadgeForPath } from '../../learning-paths';
import { GuideList } from './GuideList';
import { ProgressRing } from './ProgressRing';
import { BadgeIcon } from './BadgeIcon';
import { getTableOfContentsStyles } from './learning-paths.styles';

export interface LearningPathTableOfContentsProps {
  milestones: Milestone[];
  baseUrl: string;
  /** Package manifest ID, when known — used to look up a completion badge to preview. */
  pathId?: string;
}

export function LearningPathTableOfContents({ milestones, baseUrl, pathId }: LearningPathTableOfContentsProps) {
  const styles = useStyles2(getTableOfContentsStyles);
  const [completedSlugs, setCompletedSlugs] = useState<Set<string>>(new Set());
  const badge = pathId ? getBadgeForPath(pathId) : undefined;

  useEffect(() => {
    let cancelled = false;
    void milestoneCompletionStorage
      .getCompleted(
        baseUrl,
        milestones.map((milestone) => milestone.url)
      )
      .then((slugs) => {
        if (!cancelled) {
          setCompletedSlugs(slugs);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, milestones]);

  const guides: PathGuide[] = milestones.map((milestone) => ({
    id: String(milestone.number),
    title: milestone.title,
    description: milestone.description,
    completed: completedSlugs.has(getMilestoneSlug(milestone.url)),
    isCurrent: false,
  }));

  const completedCount = guides.filter((g) => g.completed).length;
  const progress = milestones.length > 0 ? Math.round((completedCount / milestones.length) * 100) : 0;

  // "Get started" targets the first unlocked milestone at 0% progress; once
  // underway, "Resume" targets the actual next incomplete one so returning to
  // the cover mid-path (e.g. via Previous) doesn't restart it from module 1.
  const ctaTarget = milestones.find((m) => !m.isLocked && !completedSlugs.has(getMilestoneSlug(m.url)));
  const ctaLabel = progress === 0 ? t('coverPage.getStarted', 'Get started') : t('coverPage.resume', 'Resume');

  return (
    <div className={styles.container} data-testid={testIds.learningPaths.tableOfContents}>
      <div className={styles.header}>
        <h2 className={styles.heading}>
          <Icon name="list-ul" size="md" className={styles.headingIcon} />
          {t('coverPage.tableOfContents', 'In this path')}
        </h2>
        <div className={styles.headerActions}>
          {progress > 0 && <ProgressRing progress={progress} size={40} strokeWidth={3} isCompleted={progress >= 100} />}
          {ctaTarget && (
            <button
              type="button"
              className={styles.ctaButton}
              data-journey-start="true"
              data-milestone-url={ctaTarget.url}
              data-testid={testIds.learningPaths.tableOfContentsCta}
            >
              <Icon name="play" size="sm" />
              {ctaLabel}
            </button>
          )}
        </div>
      </div>
      {badge && (
        <div className={styles.badgePreview}>
          <BadgeIcon emoji={badge.emoji} icon={badge.icon} size="sm" />
          {t('coverPage.earnsBadge', 'Earns {{badge}} badge', { badge: badge.title })}
        </div>
      )}
      <GuideList guides={guides} />
    </div>
  );
}
