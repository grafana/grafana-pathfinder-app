import React from 'react';
import { Button } from '@grafana/ui';
import { t } from '@grafana/i18n';
import { getLearningAction } from '../LearningContentCard/learning-action';

function actionText(kind: 'guide' | 'path' | 'docs', progress: number | undefined): string {
  switch (getLearningAction(kind, progress ?? 0)) {
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
  title,
  kind,
  progress,
  testId,
  disabled,
  onLaunch,
}: {
  title: string;
  kind: 'guide' | 'path' | 'docs';
  progress?: number;
  testId: string;
  disabled: boolean;
  onLaunch: () => void;
}) {
  return (
    <Button
      size="sm"
      variant="secondary"
      icon="play"
      aria-label={t('sidebarHub.actionLabel', '{{action}}: {{- title}}', {
        action: actionText(kind, progress),
        title,
      })}
      disabled={disabled}
      onClick={onLaunch}
      data-testid={testId}
    />
  );
}
