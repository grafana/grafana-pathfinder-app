import React, { useEffect, useState } from 'react';
import { useStyles2, Icon } from '@grafana/ui';
import { t } from '@grafana/i18n';

import type { Milestone } from '../../types/content.types';
import type { PathGuide } from '../../types/learning-paths.types';
import { milestoneCompletionStorage } from '../../lib/user-storage';
import { getMilestoneSlug } from '../../lib/learning-journey-url';
import { testIds } from '../../constants/testIds';
import { GuideList } from './GuideList';
import { getTableOfContentsStyles } from './learning-paths.styles';

export interface LearningPathTableOfContentsProps {
  milestones: Milestone[];
  baseUrl: string;
}

export function LearningPathTableOfContents({ milestones, baseUrl }: LearningPathTableOfContentsProps) {
  const styles = useStyles2(getTableOfContentsStyles);
  const [completedSlugs, setCompletedSlugs] = useState<Set<string>>(new Set());

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
