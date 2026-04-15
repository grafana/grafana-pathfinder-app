import React, { useCallback, useRef, useState } from 'react';
import { Badge, useStyles2 } from '@grafana/ui';
import { getFloatingPanelStyles } from './floating-panel.styles';
import logoSvg from '../../img/logo.svg';

export interface MinimizedPillProps {
  /** Whether an interactive guide is currently active */
  hasActiveGuide: boolean;
  /** Step progress string, e.g. "3/8" */
  stepProgress?: string;
  /** Called when the pill is clicked to restore the panel */
  onRestore: () => void;
}

/**
 * A small floating pill that represents the minimized floating panel.
 * Shows the Pathfinder logo with optional step progress badge.
 * Draggable so users can tuck it into any corner.
 */
export function MinimizedPill({ hasActiveGuide, stepProgress, onRestore }: MinimizedPillProps) {
  const styles = useStyles2(getFloatingPanelStyles);

  // Position state for dragging the pill
  const [pos, setPos] = useState({ x: window.innerWidth - 68, y: window.innerHeight - 68 });
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const didDragRef = useRef(false);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) {
        return;
      }
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = { startX: e.clientX, startY: e.clientY, originX: pos.x, originY: pos.y };
      didDragRef.current = false;
    },
    [pos.x, pos.y]
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) {
      return;
    }
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      didDragRef.current = true;
    }
    setPos({
      x: Math.min(Math.max(0, dragRef.current.originX + dx), window.innerWidth - 48),
      y: Math.min(Math.max(0, dragRef.current.originY + dy), window.innerHeight - 48),
    });
  }, []);

  const onPointerUp = useCallback(() => {
    if (!dragRef.current) {
      return;
    }
    const wasDrag = didDragRef.current;
    dragRef.current = null;
    if (!wasDrag) {
      onRestore();
    }
  }, [onRestore]);

  // No <Portal> needed — the parent (FloatingPanel) already renders
  // via createPortal into document.body
  return (
    <div className={styles.pillWrapper} style={{ position: 'fixed', left: pos.x, top: pos.y, zIndex: 9990 }}>
      <button
        className={`${styles.pill} ${hasActiveGuide ? styles.pillActive : ''}`}
        style={{ position: 'relative' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        aria-label="Restore floating panel"
        title="Click to restore floating panel"
      >
        <img src={logoSvg} alt="Pathfinder" className={styles.pillLogo} />
      </button>
      {stepProgress && (
        <div className={styles.pillBadge}>
          <Badge text={stepProgress} color="blue" />
        </div>
      )}
    </div>
  );
}
