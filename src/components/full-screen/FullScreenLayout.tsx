import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { IconButton, useStyles2 } from '@grafana/ui';
import { t } from '@grafana/i18n';
import { reportAppInteraction, UserInteraction } from '../../lib/analytics';
import { copyTextToClipboard } from '../../lib/clipboard';
import { testIds } from '../../constants/testIds';
import { buildPathfinderShareUrl } from '../../utils/pathfinder-search-params';
import { getFullScreenStyles } from './full-screen.styles';

export interface FullScreenLayoutProps {
  /** Title of the active guide / editor */
  title: string;
  /** "n/m" step progress for guides; omitted otherwise */
  stepProgress?: string;
  /** Active guide URL — used for the workshop "copy link" button */
  guideUrl?: string;
  /**
   * Tab type for the active guide. When 'learning-journey', the copy-link
   * URL appends `&type=learning-journey` so a recipient hitting the link
   * cold gets the milestone toolbar (otherwise findDocPage may misclassify).
   */
  guideType?: 'learning-journey' | 'docs';
  /** Whether the active tab represents a guide (vs editor / empty state) */
  hasActiveGuide: boolean;
  /** Click handler for the header back button */
  onExit: () => void;
  backLabel?: string;
  /** Click handler for the go-floating button (omit to hide it) */
  onGoFloating?: () => void;
  /**
   * Optional row rendered between the layout header and the content body —
   * used by FullScreenPanel for the learning-journey milestone toolbar.
   */
  subHeader?: React.ReactNode;
  assistant?: React.ReactNode;
  /** Body content — rendered inside the centered max-width wrapper */
  children: React.ReactNode;
}

export function FullScreenLayout({
  title,
  stepProgress,
  guideUrl,
  guideType,
  hasActiveGuide,
  onExit,
  backLabel = 'Back to sidebar',
  onGoFloating,
  subHeader,
  assistant,
  children,
}: FullScreenLayoutProps) {
  const styles = useStyles2(getFullScreenStyles);
  const containerRef = useRef<HTMLDivElement>(null);
  const [availableHeight, setAvailableHeight] = useState<number>();

  useLayoutEffect(() => {
    const container = containerRef.current;
    const page = container?.closest('main');
    if (!container || !page) {
      return;
    }
    const measure = () => {
      const offset =
        container.getBoundingClientRect().top - page.getBoundingClientRect().top - page.clientTop + page.scrollTop;
      let bottomInset = 0;
      for (let ancestor = container.parentElement; ancestor && ancestor !== page; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        bottomInset +=
          (parseFloat(style.paddingBottom) || 0) +
          (parseFloat(style.borderBottomWidth) || 0) +
          (parseFloat(style.marginBottom) || 0);
      }
      const height = page.clientHeight - offset - bottomInset;
      if (height > 0) {
        setAvailableHeight(height);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(page);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  const [linkCopy, setLinkCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const handleCopyLink = useCallback(() => {
    if (!guideUrl) {
      return;
    }
    const shareUrl = buildPathfinderShareUrl({ doc: guideUrl, panelMode: 'fullscreen', guideType });
    copyTextToClipboard(shareUrl).then((copied) => {
      setLinkCopy(copied ? 'copied' : 'failed');
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setLinkCopy('idle'), 2000);
      if (copied) {
        reportAppInteraction(UserInteraction.FullScreenCopyLink, { guide_url: guideUrl });
      }
    });
  }, [guideUrl, guideType]);

  useEffect(
    () => () => {
      clearTimeout(copyTimerRef.current);
    },
    []
  );

  return (
    <div
      ref={containerRef}
      style={{ height: availableHeight }}
      className={styles.container}
      data-pathfinder-content="true"
      data-testid={testIds.fullScreenMode.container}
      role="region"
      aria-label="Interactive learning full screen"
    >
      <div className={styles.stickyTopBar}>
        <div className={styles.header}>
          <IconButton
            name="angle-left"
            size="md"
            className={styles.headerIconButton}
            tooltip={backLabel}
            onClick={onExit}
            data-testid={testIds.fullScreenMode.exitButton}
            aria-label={backLabel}
          />
          <span className={styles.headerTitle} title={title}>
            {title}
          </span>
          {stepProgress && (
            <span
              className={styles.stepCounter}
              aria-label={t('fullScreen.stepProgressLabel', 'Step {{progress}}', { progress: stepProgress })}
            >
              {t('fullScreen.stepProgress', 'Step {{done}} of {{total}}', {
                done: stepProgress.split('/')[0],
                total: stepProgress.split('/')[1],
              })}
            </span>
          )}
          <div className={styles.headerActions}>
            {assistant}
            {hasActiveGuide && guideUrl && (
              <IconButton
                name={linkCopy === 'copied' ? 'check' : linkCopy === 'failed' ? 'exclamation-triangle' : 'link'}
                size="md"
                className={styles.headerIconButton}
                tooltip={
                  linkCopy === 'copied'
                    ? t('fullScreen.copyLinkCopied', 'Copied!')
                    : linkCopy === 'failed'
                      ? t('fullScreen.copyLinkFailed', 'Could not copy the link')
                      : t('fullScreen.copyLinkTooltip', 'Copy link to this guide')
                }
                onClick={handleCopyLink}
                aria-label={t('fullScreen.copyLinkTooltip', 'Copy link to this guide')}
                data-testid={testIds.fullScreenMode.copyLinkButton}
              />
            )}
            {onGoFloating && hasActiveGuide && (
              <IconButton
                name="corner-up-right"
                size="md"
                className={styles.headerIconButton}
                tooltip="Pop out to floating panel"
                onClick={onGoFloating}
                aria-label="Pop out to floating panel"
                data-testid={testIds.fullScreenMode.goFloatingButton}
              />
            )}
          </div>
        </div>
        {subHeader}
      </div>
      <div className={styles.body}>
        <div className={styles.contentWrap}>{children}</div>
      </div>
    </div>
  );
}
