import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import DOMPurify from 'dompurify';
import { Icon, useStyles2 } from '@grafana/ui';
import { testIds } from '../../constants/testIds';
import { getKioskOverlayStyles } from './kiosk-mode.styles';
import { fetchKioskData, BUNDLED_KIOSK_RULES, DEFAULT_BANNER, type KioskRule } from './kiosk-rules';
import { KioskTile } from './KioskTile';

// SECURITY: Tags and attributes permitted in the kiosk banner.
// Includes 'style' because admin-controlled banner content uses inline styles
// for layout — unlike sanitizeDocumentationHTML which strips style for docs.
const BANNER_SANITIZE_CONFIG: DOMPurify.Config = {
  ALLOWED_TAGS: ['div', 'img', 'h1', 'h2', 'h3', 'p', 'a', 'span', 'strong', 'em', 'br'],
  ALLOWED_ATTR: ['style', 'src', 'alt', 'href', 'target', 'rel', 'class', 'id'],
};

interface KioskOverlayProps {
  rulesUrl: string;
  onClose: () => void;
}

export const KioskOverlay: React.FC<KioskOverlayProps> = ({ rulesUrl, onClose }) => {
  const styles = useStyles2(getKioskOverlayStyles);
  const [rules, setRules] = useState<KioskRule[]>([]);
  const [banner, setBanner] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [warning, setWarning] = useState<string | null>(null);

  const sanitizedBanner = useMemo(() => {
    if (!banner) {
      return '';
    }
    try {
      return DOMPurify.sanitize(banner, BANNER_SANITIZE_CONFIG);
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
          setRules(BUNDLED_KIOSK_RULES);
          setBanner(DEFAULT_BANNER);
          setWarning(err instanceof Error ? err.message : 'Failed to load custom rules');
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

  return createPortal(
    <div
      className={styles.backdrop}
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

        {!loading && warning && (
          <div className={styles.warning} data-testid={testIds.kioskMode.error}>
            Custom rules URL failed to load ({warning}). Showing default guides.
          </div>
        )}

        {!loading && (
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
