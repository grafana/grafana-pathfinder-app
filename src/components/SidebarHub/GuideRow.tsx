import React, { useId } from 'react';
import { cx } from '@emotion/css';
import { Card, Icon, useStyles2 } from '@grafana/ui';
import { t } from '@grafana/i18n';
import { testIds } from '../../constants/testIds';
import type { Milestone } from '../../types/content.types';
import { LearningDetailsToggle } from '../LearningContentCard/LearningDetailsToggle';
import { LearningTopicIcon } from '../LearningContentCard/LearningTopicIcon';
import { getLearningContentCardStyles } from '../LearningContentCard/learning-content-card.styles';
import { GuideDetails, type HubExpansion } from './GuideDetails';
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
  expansion?: HubExpansion;
  onLaunch: () => void | Promise<void>;
}

function PlayButton({ testId, onLaunch }: { testId: string; onLaunch: () => void }) {
  const styles = useStyles2(getSidebarHubStyles);
  return (
    <button
      type="button"
      className={styles.play}
      tabIndex={-1}
      aria-hidden="true"
      data-testid={testId}
      onClick={(event) => {
        event.stopPropagation();
        onLaunch();
      }}
    >
      <Icon name="play" size="sm" />
    </button>
  );
}

interface GuideRowProps {
  guide: HubGuide;
  testId: string;
  expansionTestIds?: { toggle: string; details: string; loading: string; module: (index: number) => string };
  onLaunch: () => void;
  onOpenModule?: (module: Milestone) => void | Promise<void>;
}

export function GuideRow({ guide, testId, expansionTestIds, onLaunch, onOpenModule }: GuideRowProps) {
  const styles = useStyles2(getSidebarHubStyles);
  const cardStyles = useStyles2(getLearningContentCardStyles);
  const detailsId = useId();
  const { expansion } = guide;
  const expandable = Boolean(expansion && (expansion.hasDetails || guide.summary));
  const expanded = expandable && Boolean(expansion?.expanded);
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
        {meta.length > 0 && <Card.Meta separator="·">{meta}</Card.Meta>}
        {expansion && expandable && (
          <Card.Actions className={styles.denseToggle}>
            <LearningDetailsToggle
              expanded={expanded}
              hasDetails={expansion.hasDetails}
              label={expansion.hasModules ? t('learningCard.showModules', 'Show milestones') : undefined}
              collapseLabel={expansion.hasModules ? t('learningCard.hideModules', 'Hide milestones') : undefined}
              controls={detailsId}
              subtle
              testId={expansionTestIds?.toggle}
              onToggle={expansion.onToggle}
            />
          </Card.Actions>
        )}
        <Card.SecondaryActions className={styles.denseAction}>
          <PlayButton testId={testIds.sidebarHub.rowPlay(testId)} onLaunch={onLaunch} />
        </Card.SecondaryActions>
        {expansion && expanded && (
          <Card.Description className={styles.denseDetails}>
            <div
              id={detailsId}
              className={cx(cardStyles.details, styles.detailsBody)}
              data-testid={expansionTestIds?.details}
              onClick={(event) => event.stopPropagation()}
            >
              {guide.summary && <p className={cardStyles.description}>{guide.summary}</p>}
              <GuideDetails
                expansion={expansion}
                loadingTestId={expansionTestIds?.loading}
                moduleTestId={expansionTestIds?.module}
                onOpenModule={onOpenModule ?? expansion.onOpenModule}
              />
            </div>
          </Card.Description>
        )}
      </Card>
    </li>
  );
}
