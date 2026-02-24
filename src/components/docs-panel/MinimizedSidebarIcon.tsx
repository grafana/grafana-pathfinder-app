/**
 * Minimized Sidebar Icon
 *
 * A floating icon that appears when the sidebar is minimized during full screen mode.
 * Shows the Pathfinder logo with a step count badge and pulsing animation.
 * Clicking expands the sidebar back to full size.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Portal, Badge, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css, keyframes } from '@emotion/css';
import logoSvg from '../../img/logo.svg';
import { testIds } from '../../constants/testIds';

const pulseAnimation = keyframes`
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(255, 107, 107, 0.7);
  }
  50% {
    box-shadow: 0 0 0 8px rgba(255, 107, 107, 0);
  }
`;

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    position: 'fixed',
    right: theme.spacing(2),
    top: '50%',
    transform: 'translateY(-50%)',
    zIndex: theme.zIndex.portal,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: theme.spacing(1),
  }),
  iconButton: css({
    width: '56px',
    height: '56px',
    borderRadius: '50%',
    backgroundColor: theme.colors.background.primary,
    border: `2px solid ${theme.colors.primary.main}`,
    boxShadow: theme.shadows.z3,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'all 0.2s ease-in-out',

    '&:hover': {
      transform: 'scale(1.1)',
      boxShadow: theme.shadows.z3,
      borderColor: theme.colors.primary.shade,
    },

    '&:active': {
      transform: 'scale(0.95)',
    },
  }),
  iconButtonRecording: css({
    animation: `${pulseAnimation} 2s ease-in-out infinite`,
    borderColor: theme.colors.error.main,
  }),
  logo: css({
    width: '32px',
    height: '32px',
  }),
  badge: css({
    position: 'absolute',
    top: '-4px',
    right: '-4px',
  }),
  statusText: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    textAlign: 'center',
    maxWidth: '100px',
    backgroundColor: theme.colors.background.primary,
    padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
    borderRadius: theme.shape.radius.default,
    boxShadow: theme.shadows.z1,
  }),
  statusRecording: css({
    color: theme.colors.error.text,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  iconWrapper: css({
    position: 'relative',
  }),
});

export interface MinimizedSidebarIconProps {
  /** Whether full screen mode is active */
  isActive: boolean;
  /** Number of steps recorded */
  stepCount: number;
  /** Whether currently recording (in active state, not editing) */
  isRecording: boolean;
  /** Called when icon is clicked to expand sidebar */
  onClick: () => void;
}

/**
 * Floating icon shown when sidebar is minimized in full screen mode
 *
 * @example
 * ```tsx
 * <MinimizedSidebarIcon
 *   isActive={isFullScreenActive}
 *   stepCount={recordedSteps.length}
 *   isRecording={state === 'active'}
 *   onClick={exitFullScreenMode}
 * />
 * ```
 */
export function MinimizedSidebarIcon({ isActive, stepCount, isRecording, onClick }: MinimizedSidebarIconProps) {
  const styles = useStyles2(getStyles);

  if (!isActive) {
    return null;
  }

  return (
    <Portal>
      <div
        className={styles.container}
        data-minimized-sidebar
        data-testid={testIds.devTools.fullScreen.minimizedSidebar.container}
      >
        <div className={styles.iconWrapper}>
          <button
            className={`${styles.iconButton} ${isRecording ? styles.iconButtonRecording : ''}`}
            onClick={onClick}
            aria-label="Expand sidebar and exit full screen mode"
            title="Click to exit full screen mode"
            data-testid={testIds.devTools.fullScreen.minimizedSidebar.button}
          >
            <img src={logoSvg} alt="Pathfinder" className={styles.logo} />
          </button>
          {stepCount > 0 && (
            <div className={styles.badge} data-testid={testIds.devTools.fullScreen.minimizedSidebar.badge}>
              <Badge text={String(stepCount)} color={isRecording ? 'red' : 'blue'} />
            </div>
          )}
        </div>
        <div className={`${styles.statusText} ${isRecording ? styles.statusRecording : ''}`}>
          {isRecording ? 'Recording...' : 'Paused'}
          <br />
          Click to exit
        </div>
      </div>
    </Portal>
  );
}

/**
 * Hook to listen for full screen mode changes and manage minimized state
 */
export interface UseMinimizedSidebarOptions {
  /** Callback when sidebar should minimize */
  onMinimize?: () => void;
  /** Callback when sidebar should expand */
  onExpand?: () => void;
}

export interface UseMinimizedSidebarReturn {
  /** Whether sidebar is currently minimized */
  isMinimized: boolean;
  /** Full screen mode state from event */
  fullScreenState: string | null;
  /** Expand the sidebar (and exit full screen mode) */
  expandSidebar: () => void;
}

/**
 * Hook for sidebar components to listen to full screen mode changes
 */
export function useMinimizedSidebar(options: UseMinimizedSidebarOptions = {}): UseMinimizedSidebarReturn {
  const { onMinimize, onExpand } = options;

  const [isMinimized, setIsMinimized] = useState(false);
  const [fullScreenState, setFullScreenState] = useState<string | null>(null);

  // Listen for full screen mode changes
  useEffect(() => {
    const handleFullScreenChange = (event: CustomEvent<{ state: string; isActive: boolean }>) => {
      const { state, isActive } = event.detail;
      setFullScreenState(state);

      if (isActive && !isMinimized) {
        setIsMinimized(true);
        if (onMinimize) {
          onMinimize();
        }
      } else if (!isActive && isMinimized) {
        setIsMinimized(false);
        if (onExpand) {
          onExpand();
        }
      }
    };

    window.addEventListener('pathfinder-fullscreen-mode-changed', handleFullScreenChange as EventListener);

    return () => {
      window.removeEventListener('pathfinder-fullscreen-mode-changed', handleFullScreenChange as EventListener);
    };
  }, [isMinimized, onMinimize, onExpand]);

  // Expand sidebar programmatically
  const expandSidebar = useCallback(() => {
    setIsMinimized(false);
    if (onExpand) {
      onExpand();
    }

    // Dispatch event to notify full screen mode to exit
    const event = new CustomEvent('pathfinder-request-exit-fullscreen', {
      detail: { source: 'minimized-sidebar' },
    });
    window.dispatchEvent(event);
  }, [onExpand]);

  return {
    isMinimized,
    fullScreenState,
    expandSidebar,
  };
}

export default MinimizedSidebarIcon;
