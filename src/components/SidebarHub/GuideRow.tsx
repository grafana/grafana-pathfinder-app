import React from 'react';
import { Icon, useStyles2 } from '@grafana/ui';
import { LearningTopicIcon } from '../LearningContentCard/LearningTopicIcon';
import { testIds } from '../../constants/testIds';
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
      <button
        type="button"
        className={styles.row}
        onClick={onLaunch}
        disabled={disabled}
        data-testid={testIds.sidebarHub.row(index)}
      >
        <LearningTopicIcon topic={guide.topic} kind={guide.kind} />
        <span className={styles.rowBody}>
          <span className={styles.rowTitle}>{guide.title}</span>
          {guide.effort && <span className={styles.effort}>{guide.effort}</span>}
        </span>
        <span className={styles.play} aria-hidden="true">
          <Icon name="play" size="sm" />
        </span>
      </button>
    </li>
  );
}
