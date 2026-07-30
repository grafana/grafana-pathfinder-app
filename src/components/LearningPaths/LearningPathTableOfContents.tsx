/**
 * Learning path table of contents
 *
 * Milestone list rendered on a learning path's cover page (milestone 0). Mirrors
 * the My Learning card's guide expander via the shared GuideList, but sources its
 * items from journey metadata and resolves per-milestone completion from storage
 * (issue #1467). Display-only — the cover page's "Ready to begin" button and the
 * milestone toolbar own navigation.
 */

import React, { useEffect, useState } from 'react';
import { useStyles2, Icon } from '@grafana/ui';
import { t } from '@grafana/i18n';

import type { Milestone } from '../../types/content.types';
import type { PathGuide } from '../../types/learning-paths.types';
import { milestoneCompletionStorage } from '../../lib/user-storage';
import { getMilestoneSlug } from '../../docs-retrieval';
import { logger } from '../../lib/logging';
import { testIds } from '../../constants/testIds';
import { GuideList } from './GuideList';
import { getTableOfContentsStyles } from './learning-paths.styles';

export interface LearningPathTableOfContentsProps {
  milestones: Milestone[];
  /** Journey base URL — the completion-storage key for this path's milestones. */
  baseUrl: string;
}

export function LearningPathTableOfContents({ milestones, baseUrl }: LearningPathTableOfContentsProps) {
  const styles = useStyles2(getTableOfContentsStyles);
  const [completedSlugs, setCompletedSlugs] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    milestoneCompletionStorage
      .getCompleted(baseUrl)
      .then((slugs) => {
        if (!cancelled) {
          setCompletedSlugs(slugs);
        }
      })
      .catch((error) => {
        logger.warn('[LearningPathTableOfContents] Failed to load milestone completion', { error });
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl]);

  const guides: PathGuide[] = milestones.map((milestone) => ({
    id: String(milestone.number),
    title: milestone.title,
    completed: completedSlugs.has(getMilestoneSlug(milestone.url)),
    isCurrent: false,
  }));

  return (
    <div className={styles.container} data-testid={testIds.learningPaths.tableOfContents}>
      <h2 className={styles.heading}>
        <Icon name="list-ul" size="md" className={styles.headingIcon} />
        {t('coverPage.tableOfContents', 'In this path')}
      </h2>
      <GuideList guides={guides} />
    </div>
  );
}
