import React from 'react';
import { Icon, useStyles2 } from '@grafana/ui';
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
  const meta = [
    t('sidebarHub.moduleOf', 'Module {{current}} of {{total}}', {
      current: resume.moduleNumber,
      total: resume.moduleCount,
    }),
    resume.trackLabel,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <section
      className={styles.resume}
      aria-label={t('sidebarHub.continueLabel', 'Continue learning')}
      data-testid={testIds.sidebarHub.resume}
    >
      <ProgressRing progress={resume.percent} size={56} strokeWidth={5} />
      <div className={styles.resumeBody}>
        <span className={styles.eyebrow}>
          {t('sidebarHub.continue', 'Continue · {{- title}}', { title: resume.pathTitle })}
        </span>
        <h3 className={styles.resumeTitle}>{resume.guideTitle}</h3>
        <span className={styles.resumeMeta}>{meta}</span>
      </div>
      <button
        type="button"
        className={styles.cta}
        onClick={onResume}
        disabled={disabled}
        aria-label={t('sidebarHub.actionLabel', '{{action}}: {{- title}}', {
          action: t('learningCard.resume', 'Resume'),
          title: resume.guideTitle,
        })}
        data-testid={testIds.sidebarHub.resumeAction}
      >
        <Icon name="play" size="sm" />
        {t('learningCard.resume', 'Resume')}
      </button>
    </section>
  );
}
