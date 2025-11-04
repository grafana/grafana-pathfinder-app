/**
 * Connection Indicator Component
 * 
 * Visual indicator showing real-time connection status for live sessions
 */

import React from 'react';
import { Icon, Text, Tooltip, useStyles2, IconName } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import type { ConnectionState, ConnectionQuality } from '../../types/collaboration.types';

/**
 * Props for ConnectionIndicator
 */
interface ConnectionIndicatorProps {
  /** Current connection state */
  state: ConnectionState;
  /** Optional connection quality metrics */
  quality?: ConnectionQuality;
  /** Whether to show text label */
  showLabel?: boolean;
}

/**
 * Connection indicator component
 * 
 * Displays icon and optional label showing connection state
 */
export function ConnectionIndicator({ state, quality, showLabel = true }: ConnectionIndicatorProps) {
  const styles = useStyles2(getStyles);
  
  const getColor = (): string => {
    switch (state) {
      case 'connected':
        return styles.colorConnected;
      case 'connecting':
        return styles.colorConnecting;
      case 'disconnected':
        return styles.colorDisconnected;
      case 'failed':
        return styles.colorFailed;
      default:
        return styles.colorUnknown;
    }
  };
  
  const getIcon = (): IconName => {
    switch (state) {
      case 'connected':
        return 'check-circle';
      case 'connecting':
        return 'sync';
      case 'disconnected':
        return 'exclamation-triangle';
      case 'failed':
        return 'times-circle';
      default:
        return 'question-circle';
    }
  };
  
  const getLabel = (): string => {
    switch (state) {
      case 'connected':
        return 'Connected';
      case 'connecting':
        return 'Connecting...';
      case 'disconnected':
        return 'Disconnected';
      case 'failed':
        return 'Failed';
      default:
        return 'Unknown';
    }
  };
  
  const getTooltipContent = (): string => {
    if (!quality) {
      return getLabel();
    }
    
    return `${getLabel()}\nLatency: ${quality.latency}ms\nQuality: ${quality.quality}\nLast heartbeat: ${new Date(quality.lastHeartbeat).toLocaleTimeString()}`;
  };
  
  return (
    <Tooltip content={getTooltipContent()} placement="top">
      <div className={styles.container}>
        <Icon 
          name={getIcon()} 
          className={`${styles.icon} ${getColor()}`}
          size="sm"
        />
        {showLabel && (
          <div className={styles.label}>
            <Text variant="bodySmall">
              {getLabel()}
            </Text>
          </div>
        )}
      </div>
    </Tooltip>
  );
}

/**
 * Styles for ConnectionIndicator
 */
const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
  }),
  
  icon: css({
    // Base icon styling
  }),
  
  label: css({
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: theme.typography.bodySmall.lineHeight,
  }),
  
  // State colors
  colorConnected: css({
    color: theme.colors.success.text,
  }),
  
  colorConnecting: css({
    color: theme.colors.warning.text,
    '@keyframes spin': {
      from: { transform: 'rotate(0deg)' },
      to: { transform: 'rotate(360deg)' },
    },
    animation: 'spin 1s linear infinite',
  }),
  
  colorDisconnected: css({
    color: theme.colors.warning.text,
  }),
  
  colorFailed: css({
    color: theme.colors.error.text,
  }),
  
  colorUnknown: css({
    color: theme.colors.text.secondary,
  }),
});

