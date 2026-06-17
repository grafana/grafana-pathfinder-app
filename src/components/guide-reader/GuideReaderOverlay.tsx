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
import { InteractiveModeContext, type InteractiveMode } from '../../global-state/interactive-readonly-context';
import { PathfinderFeatureProvider } from '../OpenFeatureProvider';
import { testIds } from '../../constants/testIds';
import type { RawContent } from '../../types/content.types';
import { getGuideReaderStyles } from './guide-reader.styles';

interface GuideReaderOverlayProps {
  /** The `?doc=` value to render (e.g. `backend-guide:<id>`). */
  doc: string;
  mode?: InteractiveMode;
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
          setTheme(config.theme2);
          break;
        }
      }
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return theme;
}

/**
 * Full-screen viewer for a single guide, mounted in a new tab as a portal over
 * `document.body` at a high z-index so it covers all of Grafana's chrome — a
 * dedicated viewer. `mode` drives InteractiveModeContext: 'controller' keeps
 * step actions visible so this tab can drive the originating Grafana tab.
 */
export const GuideReaderOverlay: React.FC<GuideReaderOverlayProps> = ({ doc, mode = 'controller' }) => {
  const theme = useGrafanaTheme();
  return (
    <ThemeContext.Provider value={theme}>
      <PathfinderFeatureProvider>
        <GuideReaderInner doc={doc} mode={mode} />
      </PathfinderFeatureProvider>
    </ThemeContext.Provider>
  );
};

function GuideReaderInner({ doc, mode = 'controller' }: GuideReaderOverlayProps) {
  const styles = useStyles2(getGuideReaderStyles);
  const journeyStyles = useStyles2(journeyContentHtml);
  const docsStyles = useStyles2(docsContentHtml);
  const interactiveStyles = useStyles2(getInteractiveStyles);
  const prismStyles = useStyles2(getPrismStyles);
  const contentRef = useRef<HTMLDivElement>(null);
  const [content, setContent] = useState<RawContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closeBlocked, setCloseBlocked] = useState(false);
  const closeTimerRef = useRef<number | undefined>(undefined);

  const handleClose = useCallback(() => {
    window.close();
    // window.close() only closes tabs the script itself opened; for a bookmarked
    // or directly-navigated ?doc= URL it is a silent no-op. If the tab is still
    // here a moment later, surface an in-overlay hint instead of failing silently.
    closeTimerRef.current = window.setTimeout(() => {
      if (!window.closed) {
        setCloseBlocked(true);
      }
    }, 100);
  }, []);

  useEffect(() => () => window.clearTimeout(closeTimerRef.current), []);

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
      {closeBlocked && (
        <div className={styles.message} data-testid={testIds.guideReader.closeHint}>
          You can close this browser tab to return to Grafana.
        </div>
      )}
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
          <InteractiveModeContext.Provider value={mode}>
            <div ref={contentRef}>
              <ContentRenderer content={content} containerRef={contentRef} className={contentClassName} />
            </div>
          </InteractiveModeContext.Provider>
        )}
      </div>
    </div>,
    document.body
  );
}
