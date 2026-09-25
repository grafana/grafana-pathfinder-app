import { KioskPage } from './KioskPage';
import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import DOMPurify, { type Config as DOMPurifyConfig } from 'dompurify';
import { Button, Icon, useStyles2 } from '@grafana/ui';
import { testIds } from '../../constants/testIds';
import { getKioskOverlayStyles } from './kiosk-mode.styles';
import { loadKioskData, DEFAULT_BANNER, type KioskData } from './kiosk-rules';
import { KioskTile } from './KioskTile';
import type { KioskMode } from '../../types/kiosk-page.schema';

// SECURITY: Remote banners allow layout styles but must pass through DOMPurify.
const BANNER_SANITIZE_CONFIG: DOMPurifyConfig = {
  ALLOWED_TAGS: ['div', 'img', 'h1', 'h2', 'h3', 'p', 'a', 'span', 'strong', 'em', 'br'],
  ALLOWED_ATTR: ['style', 'src', 'alt', 'href', 'target', 'rel', 'class', 'id'],
};

interface KioskOverlayProps {
  rulesUrl: string;
  overrideUrl?: string;
  onClose: () => void;
  mode?: KioskMode;
}

export const KioskOverlay: React.FC<KioskOverlayProps> = ({
  rulesUrl,
  overrideUrl,
  onClose,
  mode = 'presentation',
}) => {
  const styles = useStyles2(getKioskOverlayStyles);
  const overlayRef = useRef<HTMLDivElement>(null);
  const exitRef = useRef<HTMLButtonElement>(null);
  const [result, setResult] = useState<{
    rulesUrl: string;
    overrideUrl?: string;
    data: KioskData & { warning?: string };
  } | null>(null);
  const current = result?.rulesUrl === rulesUrl && result?.overrideUrl === overrideUrl ? result.data : null;
  const loading = current === null;
  const rules = current?.rules ?? [];
  const page = current?.page;
  const banner = current?.banner ?? '';
  const warning = current?.warning;

  const sanitizedBanner = useMemo(() => {
    if (!banner || banner === DEFAULT_BANNER) {
      return '';
    }
    try {
      return DOMPurify.sanitize(banner, BANNER_SANITIZE_CONFIG);
    } catch {
      return '';
    }
  }, [banner]);

  useEffect(() => {
    const controller = new AbortController();
    loadKioskData(rulesUrl, overrideUrl, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setResult({ rulesUrl, overrideUrl, data });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setResult({
            rulesUrl,
            overrideUrl,
            data: { rules: [], banner: '', warning: 'The kiosk could not be loaded. Try opening it again.' },
          });
        }
      });
    return () => controller.abort();
  }, [rulesUrl, overrideUrl]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
      if (e.key === 'Tab') {
        const controls = overlayRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]'
        );
        const first = controls?.[0];
        const last = controls?.[controls.length - 1];
        if (first && last && (e.shiftKey ? document.activeElement === first : document.activeElement === last)) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        }
      }
    },
    [onClose]
  );

  useEffect(() => {
    const previousFocus = document.activeElement;
    exitRef.current?.focus();
    document.addEventListener('keydown', handleKeyDown, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus();
      }
    };
  }, [handleKeyDown]);

  return createPortal(
    <div
      ref={overlayRef}
      className={styles.backdrop}
      data-testid={testIds.kioskMode.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="Kiosk mode"
    >
      <div className={`${styles.container} ${page && page.width !== 'wide' ? styles.standardWidth : ''}`}>
        <div
          className={`${styles.header} ${page?.header === 'minimal' ? styles.minimalHeader : ''}`}
          data-testid={testIds.kioskMode.header}
        >
          {page?.header !== 'minimal' && (
            <div className={styles.titleGroup}>
              <h1 className={styles.title}>
                <Icon name="presentation-play" size="lg" /> Interactive guides
              </h1>
              <p className={styles.subtitle}>
                {mode === 'instance'
                  ? 'Choose a guide to follow in this Grafana instance'
                  : 'Select a guide to launch it in a new tab'}
              </p>
            </div>
          )}
          <Button
            ref={exitRef}
            variant="secondary"
            icon="times"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Exit kiosk"
            data-testid={testIds.kioskMode.closeButton}
          >
            Exit kiosk
          </Button>
        </div>

        {!loading && !page && banner === DEFAULT_BANNER && (
          <section className={styles.learningBanner} aria-labelledby="kiosk-learning-title">
            <div className={styles.learningMark} aria-hidden="true">
              <Icon name="book-open" size="xxxl" />
            </div>
            <div className={styles.learningCopy}>
              <span className={styles.learningEyebrow}>Grafana learning</span>
              <h2 id="kiosk-learning-title" className={styles.learningTitle}>
                Learn Grafana
              </h2>
              <p className={styles.learningDescription}>Explore interactive guides.</p>
            </div>
          </section>
        )}

        {!loading && !page && sanitizedBanner && (
          // eslint-disable-next-line no-restricted-syntax -- remote kiosk banner sanitized with DOMPurify
          <div className={styles.banner} dangerouslySetInnerHTML={{ __html: sanitizedBanner }} />
        )}

        {loading && (
          <div className={styles.loading} data-testid={testIds.kioskMode.loading}>
            Loading guides...
          </div>
        )}

        {!loading && warning && (
          <div className={styles.warning} data-testid={testIds.kioskMode.warning}>
            {warning}
          </div>
        )}

        {!loading && page && (
          <KioskPage
            key={`${rulesUrl}-${overrideUrl ?? ''}`}
            page={page}
            rules={rules}
            mode={mode}
            onLaunch={onClose}
          />
        )}
        {!loading && !page && (
          <div className={styles.grid} data-testid={testIds.kioskMode.tileGrid}>
            {rules.map((rule, index) => (
              <KioskTile key={rule.url} rule={rule} index={index} mode={mode} onLaunch={onClose} />
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};
