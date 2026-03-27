import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Icon, useStyles2 } from '@grafana/ui';
import { testIds } from '../../constants/testIds';
import { getKioskOverlayStyles } from './kiosk-mode.styles';
import { fetchKioskData, type KioskRule } from './kiosk-rules';
import { KioskTile } from './KioskTile';
import { sanitizeDocumentationHTML } from '../../security/html-sanitizer';

interface KioskOverlayProps {
  rulesUrl: string;
  onClose: () => void;
}

export const KioskOverlay: React.FC<KioskOverlayProps> = ({ rulesUrl, onClose }) => {
  const styles = useStyles2(getKioskOverlayStyles);
  const [rules, setRules] = useState<KioskRule[]>([]);
  const [banner, setBanner] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const sanitizedBanner = useMemo(() => {
    if (!banner) {
      return '';
    }
    try {
      return sanitizeDocumentationHTML(banner);
    } catch {
      return '';
    }
  }, [banner]);

  useEffect(() => {
    let cancelled = false;

    fetchKioskData(rulesUrl)
      .then((result) => {
        if (!cancelled) {
          setRules(result.rules);
          setBanner(result.banner);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load rules');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [rulesUrl]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [handleKeyDown]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  return createPortal(
    <div
      className={styles.backdrop}
      onClick={handleBackdropClick}
      data-testid={testIds.kioskMode.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="Kiosk mode"
    >
      <div className={styles.container}>
        <div className={styles.header} data-testid={testIds.kioskMode.header}>
          <div className={styles.titleGroup}>
            <h1 className={styles.title}>
              <Icon name="presentation-play" size="lg" /> Interactive Guides
            </h1>
            <p className={styles.subtitle}>Select a guide to launch it in a new tab</p>
          </div>
          <button
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close kiosk mode"
            data-testid={testIds.kioskMode.closeButton}
          >
            <Icon name="times" />
          </button>
        </div>

        {/* Banner block — sanitized HTML from JSON, themed by the content author */}
        {!loading && sanitizedBanner && (
          // eslint-disable-next-line no-restricted-syntax -- admin-controlled CDN content, sanitized with DOMPurify
          <div className={styles.banner} dangerouslySetInnerHTML={{ __html: sanitizedBanner }} />
        )}

        {loading && (
          <div className={styles.loading} data-testid={testIds.kioskMode.loading}>
            Loading guides...
          </div>
        )}

        {error && (
          <div className={styles.error} data-testid={testIds.kioskMode.error}>
            {error}
          </div>
        )}

        {!loading && !error && (
          <div className={styles.grid} data-testid={testIds.kioskMode.tileGrid}>
            {rules.map((rule, index) => (
              <KioskTile key={rule.url} rule={rule} index={index} />
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};
