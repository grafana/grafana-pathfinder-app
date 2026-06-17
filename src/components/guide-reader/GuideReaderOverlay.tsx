import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ThemeContext } from '@grafana/data';
import { config } from '@grafana/runtime';
import { Icon, useStyles2 } from '@grafana/ui';

import { ContentRenderer } from '../content-renderer/content-renderer';
import { fetchUnifiedContent } from '../../docs-retrieval';
import { journeyContentHtml, docsContentHtml } from '../../styles/content-html.styles';
import { getInteractiveStyles } from '../../styles/interactive.styles';
import { getPrismStyles } from '../../styles/prism.styles';
import { PathfinderFeatureProvider } from '../OpenFeatureProvider';
import { testIds } from '../../constants/testIds';
import type { RawContent } from '../../types/content.types';
import { getGuideReaderStyles } from './guide-reader.styles';

interface GuideReaderOverlayProps {
  /** The `?doc=` value to render (e.g. `backend-guide:<id>`). */
  doc: string;
}

// Mirrors FloatingPanelManager: this tree is mounted in a standalone root
// (createCompatRoot) outside Grafana's provider tree, so it must supply its
// own theme. The body-class observer keeps it in sync with theme switches.
function useGrafanaTheme() {
  const [theme, setTheme] = useState(() => config.theme2);

  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.attributeName === 'class') {
          if (config.theme2 !== theme) {
            setTheme(config.theme2);
          }
          break;
        }
      }
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [theme]);

  return theme;
}

/**
 * Full-screen viewer for a single guide, mounted in a new tab as a portal over
 * `document.body` at a high z-index so it covers all of Grafana's chrome — the
 * tab is a dedicated reader, not a second live Grafana to wander into.
 */
export const GuideReaderOverlay: React.FC<GuideReaderOverlayProps> = ({ doc }) => {
  const theme = useGrafanaTheme();
  return (
    <ThemeContext.Provider value={theme}>
      <PathfinderFeatureProvider>
        <GuideReaderInner doc={doc} />
      </PathfinderFeatureProvider>
    </ThemeContext.Provider>
  );
};

function GuideReaderInner({ doc }: GuideReaderOverlayProps) {
  const styles = useStyles2(getGuideReaderStyles);
  const journeyStyles = useStyles2(journeyContentHtml);
  const docsStyles = useStyles2(docsContentHtml);
  const interactiveStyles = useStyles2(getInteractiveStyles);
  const prismStyles = useStyles2(getPrismStyles);
  const contentRef = useRef<HTMLDivElement>(null);
  const [content, setContent] = useState<RawContent | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleClose = useCallback(() => window.close(), []);

  useEffect(() => {
    let cancelled = false;
    fetchUnifiedContent(doc)
      .then((result) => {
        if (cancelled) {
          return;
        }
        if (result.content) {
          setContent(result.content);
        } else {
          setError(result.error ?? 'Could not load this guide.');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('Could not load this guide.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [doc]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
    };
  }, [handleClose]);

  const contentClassName = content
    ? `${content.type === 'learning-journey' ? journeyStyles : docsStyles} ${interactiveStyles} ${prismStyles}`
    : '';

  return createPortal(
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label="Guide reader"
      data-testid={testIds.guideReader.overlay}
    >
      <button
        className={styles.closeButton}
        onClick={handleClose}
        aria-label="Close reader"
        data-testid={testIds.guideReader.closeButton}
      >
        <Icon name="times" />
      </button>
      <div className={styles.container}>
        {error && (
          <div className={styles.message} data-testid={testIds.guideReader.error}>
            {error}
          </div>
        )}
        {!error && !content && (
          <div className={styles.message} data-testid={testIds.guideReader.loading}>
            Loading guide...
          </div>
        )}
        {content && (
          <div ref={contentRef}>
            <ContentRenderer content={content} containerRef={contentRef} className={contentClassName} />
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
