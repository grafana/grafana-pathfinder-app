/**
 * Selector Test Overlay
 *
 * Portal component that highlights matched DOM elements with numbered badges.
 * Auto-dismisses after 3 seconds.
 */

import React, { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';

interface SelectorTestOverlayProps {
  elements: HTMLElement[];
  onDismiss: () => void;
}

interface OverlayRect {
  top: number;
  left: number;
  width: number;
  height: number;
  index: number;
}

export function SelectorTestOverlay({ elements, onDismiss }: SelectorTestOverlayProps) {
  const styles = useStyles2(getStyles);

  const rects = useMemo<OverlayRect[]>(
    () =>
      elements.map((el, i) => {
        const rect = el.getBoundingClientRect();
        return {
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          index: i + 1,
        };
      }),
    [elements]
  );

  // Auto-dismiss after 3 seconds
  useEffect(() => {
    const timer = setTimeout(onDismiss, 3000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  if (rects.length === 0) {
    return null;
  }

  return createPortal(
    <div className={styles.backdrop} onClick={onDismiss}>
      {rects.map((r) => (
        <div
          key={r.index}
          className={styles.highlight}
          style={{
            top: r.top,
            left: r.left,
            width: r.width,
            height: r.height,
          }}
        >
          <span className={styles.badge}>{r.index}</span>
        </div>
      ))}
    </div>,
    document.body
  );
}

SelectorTestOverlay.displayName = 'SelectorTestOverlay';

const getStyles = (theme: GrafanaTheme2) => ({
  backdrop: css({
    position: 'fixed',
    inset: 0,
    zIndex: 99998,
    pointerEvents: 'auto',
    cursor: 'pointer',
  }),
  highlight: css({
    position: 'fixed',
    border: `2px solid ${theme.colors.primary.main}`,
    backgroundColor: 'rgba(70, 130, 230, 0.12)',
    borderRadius: theme.shape.radius.default,
    pointerEvents: 'none',
  }),
  badge: css({
    position: 'absolute',
    top: -10,
    right: -10,
    width: 20,
    height: 20,
    borderRadius: '50%',
    backgroundColor: theme.colors.primary.main,
    color: theme.colors.primary.contrastText,
    fontSize: 11,
    fontWeight: theme.typography.fontWeightBold,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  }),
});
