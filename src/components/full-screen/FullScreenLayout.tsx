import React, { useCallback, useEffect, useRef, useState } from 'react';
import { IconButton, useStyles2 } from '@grafana/ui';
import { t } from '@grafana/i18n';
import { reportAppInteraction, UserInteraction } from '../../lib/analytics';
import { testIds } from '../../constants/testIds';
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
  /** Click handler for the back-to-sidebar button */
  onExit: () => void;
  /** Click handler for the go-floating button (omit to hide it) */
  onGoFloating?: () => void;
  /**
   * Optional row rendered between the layout header and the content body —
   * used by FullScreenPanel for the learning-journey milestone toolbar.
   */
  subHeader?: React.ReactNode;
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
  onGoFloating,
  subHeader,
  children,
}: FullScreenLayoutProps) {
  const styles = useStyles2(getFullScreenStyles);
  const [linkCopied, setLinkCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const handleCopyLink = useCallback(() => {
    if (!guideUrl) {
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set('doc', guideUrl);
    url.searchParams.set('panelMode', 'fullscreen');
    if (guideType) {
      url.searchParams.set('type', guideType);
    }
    navigator.clipboard
      .writeText(url.toString())
      .then(() => {
        setLinkCopied(true);
        clearTimeout(copyTimerRef.current);
        copyTimerRef.current = setTimeout(() => setLinkCopied(false), 2000);
        reportAppInteraction(UserInteraction.FullScreenCopyLink, { guide_url: guideUrl });
      })
      .catch(() => {
        // Clipboard may be unavailable in some contexts
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
      className={styles.container}
      data-pathfinder-content="true"
      data-testid={testIds.fullScreenMode.container}
      role="region"
      aria-label="Pathfinder full screen"
    >
      <div className={styles.stickyTopBar}>
        <div className={styles.header}>
          <IconButton
            name="angle-left"
            size="md"
            tooltip="Back to sidebar"
            onClick={onExit}
            data-testid={testIds.fullScreenMode.exitButton}
            aria-label="Back to sidebar"
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
            {hasActiveGuide && guideUrl && (
              <IconButton
                name={linkCopied ? 'check' : 'link'}
                size="sm"
                tooltip={
                  linkCopied
                    ? t('fullScreen.copyLinkCopied', 'Copied!')
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
                size="sm"
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
