import React, { useEffect, useRef, useState } from 'react';
import { Button, Icon, useStyles2 } from '@grafana/ui';
import { t } from '@grafana/i18n';
import { cx } from '@emotion/css';
import type { Milestone, RawContent } from '../../types/content.types';
import type { AnalyticsCompletionIdentity } from '../../docs-retrieval';
import { useBooleanFlag } from '../../utils/openfeature';
import { LearningContentCard } from '../LearningContentCard/LearningContentCard';
import { openLearningHome, openCatalogBrowser } from '../docs-panel/utils/open-catalog-browser';
import { getCompletionPanelStyles } from './completion-panel.styles';
import { CompletionSuggestions } from './CompletionSuggestions';

export interface CompletionPanelProps {
  content: RawContent;
  completionIdentity?: AnalyticsCompletionIdentity;
  nextModule?: Milestone;
  onContinue?: () => void | Promise<void>;
  moduleContext?: { position: number; total: number; pathComplete?: boolean };
  celebrating?: boolean;
  onView?: () => void;
}

export function CompletionPanel({
  content,
  completionIdentity,
  nextModule,
  onContinue,
  moduleContext,
  celebrating = false,
  onView,
}: CompletionPanelProps) {
  const styles = useStyles2(getCompletionPanelStyles);
  const browseEnabled = useBooleanFlag('pathfinder.package-browser', true);
  const panel = useRef<HTMLElement>(null);
  const viewed = useRef(false);
  useEffect(() => {
    const element = panel.current;
    if (!element || !onView || viewed.current || typeof IntersectionObserver === 'undefined') {
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (!viewed.current && entries.some((entry) => entry.isIntersecting)) {
        viewed.current = true;
        onView();
        observer.disconnect();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [onView]);
  const heading = moduleContext?.pathComplete
    ? t('completionPanel.pathComplete', 'Path complete')
    : moduleContext
      ? t('completionPanel.milestoneComplete', 'Milestone complete')
      : t('completionPanel.guideComplete', 'Guide complete');

  return (
    <section
      ref={panel}
      tabIndex={-1}
      aria-label={heading}
      className={cx(styles.panel, celebrating && styles.celebrating)}
      data-testid="completion-panel"
    >
      <div className={styles.success}>
        <span className={styles.check} aria-hidden="true">
          <Icon name="check" size="lg" />
        </span>
        <div className={styles.heading}>
          <h2>{heading}</h2>
          {moduleContext && !moduleContext.pathComplete && (
            <div className={styles.metadata}>
              {t('completionPanel.milestonePosition', 'Milestone {{position}} of {{total}}', moduleContext)}
            </div>
          )}
        </div>
      </div>
      {nextModule && onContinue ? (
        <NextModule key={nextModule.url} module={nextModule} onContinue={onContinue} />
      ) : browseEnabled ? (
        <CompletionSuggestions
          content={content}
          completionIdentity={completionIdentity}
          inPath={Boolean(moduleContext)}
        />
      ) : null}
      <div className={styles.footer}>
        {browseEnabled && (
          <Button
            className={styles.navigationAction}
            variant="secondary"
            icon="arrow-right"
            onClick={() => openCatalogBrowser({ source: 'content_completion_panel' })}
          >
            {t('completionPanel.explore', 'Explore learning')}
          </Button>
        )}
        <Button
          className={styles.navigationAction}
          variant="secondary"
          icon="book-open"
          onClick={() => openLearningHome({ source: 'content_completion_panel' })}
        >
          {t('completionPanel.myLearning', 'My learning')}
        </Button>
      </div>
    </section>
  );
}

function NextModule({ module, onContinue }: { module: Milestone; onContinue: () => void | Promise<void> }) {
  const styles = useStyles2(getCompletionPanelStyles);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const launch = async () => {
    if (lock.current || module.isLocked) {
      return;
    }
    lock.current = true;
    setPending(true);
    setFailed(false);
    try {
      await onContinue();
    } catch {
      if (mounted.current) {
        setFailed(true);
      }
    } finally {
      lock.current = false;
      if (mounted.current) {
        setPending(false);
      }
    }
  };
  return (
    <div>
      <LearningContentCard
        variant="completion-primary"
        eyebrow={t('completionPanel.nextMilestone', 'Next in your path')}
        title={module.title}
        topic="getting-started"
        kind="guide"
        description={module.description}
        effort={
          module.estimatedMinutes !== undefined
            ? t('completionPanel.minutes', 'About {{minutes}} min', { minutes: module.estimatedMinutes })
            : undefined
        }
        actionLabel={t('completionPanel.continueMilestone', 'Continue to next milestone')}
        onLaunch={launch}
        launching={pending}
        launchDisabled={module.isLocked}
        launchError={
          failed ? t('completionPanel.milestoneLaunchError', 'Unable to open this milestone. Try again.') : undefined
        }
      />
      {module.isLocked && (
        <p className={styles.metadata}>
          {t('completionPanel.milestoneUnavailable', 'This milestone is currently unavailable.')}
        </p>
      )}
    </div>
  );
}
