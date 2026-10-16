import React from 'react';
import { Alert, Icon, useStyles2 } from '@grafana/ui';
import { t } from '@grafana/i18n';
import { testIds } from '../../constants/testIds';
import type { HubResume, HubStats } from '../../learning-paths';
import { FeaturedGuide } from './FeaturedGuide';
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
    <div className={styles.root} data-testid={testIds.sidebarHub.container}>
      <header className={styles.header}>
        <div className={styles.greeting}>
          <h2 className={styles.greetingTitle}>
            {userName
              ? t('sidebarHub.welcomeBackName', 'Welcome back, {{- name}}', { name: userName })
              : t('sidebarHub.welcomeBack', 'Welcome back')}
          </h2>
          <p className={styles.subtitle}>{t('sidebarHub.subtitle', 'Learn Grafana at your own pace')}</p>
        </div>
        <button
          type="button"
          className={styles.myLearning}
          onClick={() => onOpenMyLearning('header')}
          data-testid={testIds.sidebarHub.myLearning}
        >
          <Icon name="book-open" size="sm" />
          {t('docsPanel.myLearning', 'My learning')}
        </button>
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
        <div className={styles.skeleton} data-testid={testIds.sidebarHub.loading} />
      ) : (
        featured && <FeaturedGuide guide={featured} disabled={pending} onLaunch={() => run(featured.onLaunch)} />
      )}

      {isLoadingLearning ? (
        <div className={styles.skeleton} data-testid={testIds.sidebarHub.loading} />
      ) : (
        <>
          {resume && <ResumeCard resume={resume} disabled={pending} onResume={() => run(() => onResume(resume))} />}
          <StatTiles stats={stats} onOpen={onOpenMyLearning} />
        </>
      )}

      {more.length > 0 && (
        <>
          <h3 className={styles.sectionTitle}>{t('sidebarHub.moreRecommended', 'More recommended')}</h3>
          <ul className={styles.list} data-testid={testIds.sidebarHub.moreList}>
            {more.map((guide, index) => (
              <GuideRow
                key={guide.key}
                guide={guide}
                index={index}
                disabled={pending}
                onLaunch={() => run(guide.onLaunch)}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
