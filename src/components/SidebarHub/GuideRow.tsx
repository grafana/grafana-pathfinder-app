import React from 'react';
import { Card, useStyles2 } from '@grafana/ui';
import { LearningTopicIcon } from '../LearningContentCard/LearningTopicIcon';
import { testIds } from '../../constants/testIds';
import { HubActionButton } from './HubActionButton';
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

export function GuideRow({
  guide,
  index,
  disabled,
  onLaunch,
}: {
  guide: HubGuide;
  index: number;
  disabled: boolean;
  onLaunch: () => void;
}) {
  const styles = useStyles2(getSidebarHubStyles);

  return (
    <li>
      <Card isCompact noMargin className={styles.denseCard}>
        <Card.Figure align="center">
          <LearningTopicIcon topic={guide.topic} kind={guide.kind} />
        </Card.Figure>
        <Card.Heading>{guide.title}</Card.Heading>
        {guide.effort && <Card.Meta>{[guide.effort]}</Card.Meta>}
        <Card.SecondaryActions className={styles.denseAction}>
          <HubActionButton
            title={guide.title}
            kind={guide.kind}
            progress={guide.progress}
            testId={testIds.sidebarHub.row(index)}
            disabled={disabled}
            onLaunch={onLaunch}
          />
        </Card.SecondaryActions>
      </Card>
    </li>
  );
}
