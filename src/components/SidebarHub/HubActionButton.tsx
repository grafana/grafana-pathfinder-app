import React from 'react';
import { Icon } from '@grafana/ui';
import { t } from '@grafana/i18n';
import { getLearningAction } from '../LearningContentCard/learning-action';
import type { HubGuide } from './GuideRow';

function actionText(guide: HubGuide): string {
  switch (getLearningAction(guide.kind, guide.progress ?? 0)) {
    case 'read':
      return t('learningCard.read', 'Read');
    case 'review':
      return t('learningCard.review', 'Review');
    case 'resume':
      return t('learningCard.resume', 'Resume');
    case 'start':
      return t('sidebarHub.start', 'Start');
  }
}

export function HubActionButton({
  guide,
  className,
  testId,
  disabled,
  onLaunch,
}: {
  guide: HubGuide;
  className: string;
  testId: string;
  disabled: boolean;
  onLaunch: () => void;
}) {
  const text = actionText(guide);
  return (
    <button
      type="button"
      className={className}
      onClick={onLaunch}
      disabled={disabled}
      aria-label={t('sidebarHub.actionLabel', '{{action}}: {{- title}}', { action: text, title: guide.title })}
      data-testid={testId}
    >
      <Icon name="play" size="sm" />
      {text}
    </button>
  );
}
