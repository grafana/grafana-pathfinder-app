import React from 'react';
import { Card, Icon, useStyles2 } from '@grafana/ui';
import { LearningTopicIcon } from '../LearningContentCard/LearningTopicIcon';
import { testIds } from '../../constants/testIds';
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

export function GuideRow({ guide, index, onLaunch }: { guide: HubGuide; index: number; onLaunch: () => void }) {
  const styles = useStyles2(getSidebarHubStyles);

  return (
    <li>
      <Card
        isCompact
        noMargin
        className={styles.denseCard}
        onClick={onLaunch}
        data-testid={testIds.sidebarHub.row(index)}
      >
        <Card.Figure align="center">
          <LearningTopicIcon topic={guide.topic} kind={guide.kind} />
        </Card.Figure>
        <Card.Heading
          className={styles.denseHeading}
          aria-label={getHubActionLabel(guide.kind, guide.progress, guide.title)}
        >
          {guide.title}
        </Card.Heading>
        {guide.effort && <Card.Meta>{[guide.effort]}</Card.Meta>}
        <Card.SecondaryActions className={styles.denseAction}>
          <PlayGlyph />
        </Card.SecondaryActions>
      </Card>
    </li>
  );
}
