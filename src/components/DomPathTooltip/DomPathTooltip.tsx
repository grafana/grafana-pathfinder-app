/**
 * DOM Path Tooltip Component
 * Displays the full DOM path of the hovered element during element inspection
 */

import React from 'react';
import { useStyles2 } from '@grafana/ui';
import { getDomPathTooltipStyles } from './dom-path-tooltip.styles';

export interface DomPathTooltipProps {
  /** The DOM path to display */
  domPath: string;
  /** Cursor position for tooltip placement */
  position: { x: number; y: number };
  /** Whether the tooltip is visible */
  visible: boolean;
}

/**
 * Tooltip that follows the cursor and shows the full DOM path
 *
 * @example
 * ```tsx
 * <DomPathTooltip
 *   domPath="body > div.container > button[data-testid='save']"
 *   position={{ x: 100, y: 200 }}
 *   visible={true}
 * />
 * ```
 */
export function DomPathTooltip({ domPath, position, visible }: DomPathTooltipProps) {
  const styles = useStyles2(getDomPathTooltipStyles);

  if (!visible || !domPath) {
    return null;
  }

  // Offset from cursor to avoid obscuring the element
  const OFFSET_X = 15;
  const OFFSET_Y = 15;

  return (
    <div
      className={styles.tooltip}
      data-inspector-tooltip="true"
      style={{
        left: `${position.x + OFFSET_X}px`,
        top: `${position.y + OFFSET_Y}px`,
      }}
    >
      {domPath}
    </div>
  );
}

