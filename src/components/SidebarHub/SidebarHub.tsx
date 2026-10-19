import React from 'react';
import { Alert, Button, Stack, Text, useStyles2 } from '@grafana/ui';
import { t } from '@grafana/i18n';
import { SkeletonLoader } from '../SkeletonLoader';
import { testIds } from '../../constants/testIds';
import type { HubResume, HubStats } from '../../learning-paths';
import { FeaturedGuide } from './FeaturedGuide';
import { CustomGuides } from './CustomGuides';
import { GuideRow, type HubGuide } from './GuideRow';
import { ResumeCard } from './ResumeCard';
import { StatTiles, type HubTile } from './StatTiles';
import { getSidebarHubStyles } from './sidebar-hub.styles';
import { useGuardedLaunch } from './use-guarded-launch';

const MORE_RECOMMENDED_COUNT = 3;

export type HubSource = 'header' | HubTile;

interface SidebarHubProps {
  userName?: string;
  /** The top recommendation first, then the rest in order. */
  guides: HubGuide[];
  resume: HubResume | null;
  stats: HubStats;
  /** Temporary: org custom guides, until the hub replaces the old Recommended tab. */
  customGuides: HubGuide[];
  isLoadingCustomGuides: boolean;
  isLoadingGuides: boolean;
  isLoadingLearning: boolean;
  recommendationsError: string | null;
  onOpenMyLearning: (source: HubSource) => void;
  onResume: (resume: HubResume) => void | Promise<void>;
}

export function SidebarHub({
  userName,
  guides,
  resume,
  stats,
  customGuides,
  isLoadingCustomGuides,
  isLoadingGuides,
  isLoadingLearning,
  recommendationsError,
  onOpenMyLearning,
  onResume,
}: SidebarHubProps) {
  const styles = useStyles2(getSidebarHubStyles);
  const { pending, run } = useGuardedLaunch();
  const [featured, ...rest] = guides;
  const more = rest.slice(0, MORE_RECOMMENDED_COUNT);

  return (
    <Stack direction="column" gap={1.5} data-testid={testIds.sidebarHub.container}>
      <header className={styles.header}>
        <div className={styles.greeting}>
          <Text element="h2" variant="h3">
            {userName
              ? t('sidebarHub.welcomeBackName', 'Welcome back, {{- name}}', { name: userName })
              : t('sidebarHub.welcomeBack', 'Welcome back')}
          </Text>
          <Text element="p" variant="bodySmall" color="secondary">
            {t('sidebarHub.subtitle', 'Learn Grafana at your own pace')}
          </Text>
        </div>
        <Button
          variant="secondary"
          size="sm"
          icon="book-open"
          className={styles.myLearning}
          onClick={() => onOpenMyLearning('header')}
          data-testid={testIds.sidebarHub.myLearning}
        >
          {t('docsPanel.myLearning', 'My learning')}
        </Button>
      </header>

      {recommendationsError && (
        <Alert
          severity="warning"
          title={t('contextPanel.recommendationsUnavailable', 'Recommendations unavailable')}
          data-testid={testIds.contextPanel.errorAlert}
        >
          {recommendationsError}
        </Alert>
      )}

      {isLoadingGuides ? (
        <div data-testid={testIds.sidebarHub.loading}>
          <SkeletonLoader type="recommendations" />
        </div>
      ) : (
        featured && <FeaturedGuide guide={featured} disabled={pending} onLaunch={() => run(featured.onLaunch)} />
      )}

      {isLoadingLearning ? (
        <div data-testid={testIds.sidebarHub.loading}>
          <SkeletonLoader type="recommendations" />
        </div>
      ) : (
        <>
          {resume && <ResumeCard resume={resume} disabled={pending} onResume={() => run(() => onResume(resume))} />}
          <StatTiles stats={stats} onOpen={onOpenMyLearning} />
        </>
      )}

      {more.length > 0 && (
        <>
          <Text element="h3" variant="h5">
            {t('sidebarHub.moreRecommended', 'More recommended')}
          </Text>
          <ul className={styles.list} data-testid={testIds.sidebarHub.moreList}>
            {more.map((guide, index) => (
              <GuideRow
                key={guide.key}
                guide={guide}
                testId={testIds.sidebarHub.row(index)}
                onLaunch={() => run(guide.onLaunch)}
              />
            ))}
          </ul>
        </>
      )}
      <CustomGuides guides={customGuides} isLoading={isLoadingCustomGuides} onLaunch={(guide) => run(guide.onLaunch)} />
    </Stack>
  );
}
