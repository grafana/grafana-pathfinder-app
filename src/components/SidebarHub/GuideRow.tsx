import React from 'react';
import { Card, Icon, useStyles2 } from '@grafana/ui';
import { t } from '@grafana/i18n';
import { LearningTopicIcon } from '../LearningContentCard/LearningTopicIcon';
import { getHubActionLabel } from './hub-action-label';
import { getSidebarHubStyles } from './sidebar-hub.styles';

export interface HubGuide {
  key: string;
  title: string;
  summary?: string;
  topic: string;
  kind: 'guide' | 'path' | 'docs';
  effort: string;
  progress?: number;
  organization?: boolean;
  badges?: React.ReactNode;
  onLaunch: () => void | Promise<void>;
}

function PlayGlyph() {
  const styles = useStyles2(getSidebarHubStyles);
  return (
    <span className={styles.play} aria-hidden="true">
      <Icon name="play" size="sm" />
    </span>
  );
}

export function GuideRow({ guide, testId, onLaunch }: { guide: HubGuide; testId: string; onLaunch: () => void }) {
  const styles = useStyles2(getSidebarHubStyles);
  const meta = [
    guide.organization && <span key="org">{t('learningCard.organization', 'Your organization')}</span>,
    guide.effort && <span key="effort">{guide.effort}</span>,
    guide.badges && <span key="badges">{guide.badges}</span>,
  ].filter(Boolean);

  return (
    <li>
      <Card isCompact noMargin className={styles.denseCard} onClick={onLaunch} data-testid={testId}>
        <Card.Figure align="center">
          <LearningTopicIcon topic={guide.topic} kind={guide.kind} />
        </Card.Figure>
        <Card.Heading
          className={styles.denseHeading}
          aria-label={getHubActionLabel(guide.kind, guide.progress, guide.title)}
        >
          {guide.title}
        </Card.Heading>
        {meta.length > 0 && <Card.Meta>{meta}</Card.Meta>}
        <Card.SecondaryActions className={styles.denseAction}>
          <PlayGlyph />
        </Card.SecondaryActions>
      </Card>
    </li>
  );
}
