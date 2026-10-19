import React from 'react';
import { cx } from '@emotion/css';
import { Button, Card, useStyles2 } from '@grafana/ui';
import { t } from '@grafana/i18n';
import { ProgressRing } from '../LearningPaths/ProgressRing';
import { testIds } from '../../constants/testIds';
import type { HubResume } from '../../learning-paths';
import { getSidebarHubStyles } from './sidebar-hub.styles';

export function ResumeCard({
  resume,
  disabled,
  onResume,
}: {
  resume: HubResume;
  disabled: boolean;
  onResume: () => void;
}) {
  const styles = useStyles2(getSidebarHubStyles);
  const moduleText = t('sidebarHub.moduleOf', 'Module {{current}} of {{total}}', {
    current: resume.moduleNumber,
    total: resume.moduleCount,
  });

  return (
    <Card
      noMargin
      role="region"
      aria-label={t('sidebarHub.continueLabel', 'Continue learning')}
      className={cx(styles.denseCard, styles.resume)}
      data-testid={testIds.sidebarHub.resume}
    >
      <Card.Figure align="center" className={styles.ringFigure}>
        <ProgressRing progress={resume.percent} size={56} strokeWidth={5} />
      </Card.Figure>
      <Card.Heading className={styles.denseHeading}>{resume.guideTitle}</Card.Heading>
      <Card.Meta>
        {[
          <span key="meta">
            {resume.pathTitle} · <span className={styles.noWrap}>{moduleText}</span>
            {resume.trackLabel && (
              <>
                {' '}
                · <span className={styles.noWrap}>{resume.trackLabel}</span>
              </>
            )}
          </span>,
        ]}
      </Card.Meta>
      <Card.SecondaryActions className={styles.denseAction}>
        <Button
          size="sm"
          icon="play"
          onClick={onResume}
          disabled={disabled}
          aria-label={t('sidebarHub.actionLabel', '{{action}}: {{- title}}', {
            action: t('learningCard.resume', 'Resume'),
            title: resume.guideTitle,
          })}
          data-testid={testIds.sidebarHub.resumeAction}
        >
          {t('learningCard.resume', 'Resume')}
        </Button>
      </Card.SecondaryActions>
    </Card>
  );
}
