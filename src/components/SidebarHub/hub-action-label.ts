import { t } from '@grafana/i18n';
import { getLearningAction } from '../LearningContentCard/learning-action';

export function getHubActionLabel(
  kind: 'guide' | 'path' | 'docs',
  progress: number | undefined,
  title: string
): string {
  const action = (() => {
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
  })();
  return t('sidebarHub.actionLabel', '{{action}}: {{- title}}', { action, title });
}
