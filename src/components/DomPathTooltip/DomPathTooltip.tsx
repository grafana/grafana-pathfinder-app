/**
 * DOM Path Tooltip Component
 * Displays the full DOM path of the hovered element during element inspection
 */

import React from 'react';
import { useStyles2 } from '@grafana/ui';
import { getDomPathTooltipStyles } from './dom-path-tooltip.styles';
import { testIds } from '../../constants/testIds';

export interface DomPathTooltipProps {
  /** The DOM path to display */
  domPath: string;
  /** Cursor position for tooltip placement */
  position: { x: number; y: number };
  /** Whether the tooltip is visible */
  visible: boolean;
}

/**
 * Parse DOM path and highlight testid attributes in orange
 * @param path - The DOM path string (e.g., "body > div > button[data-testid='save']")
 * @returns Array of segments with testid highlighting info
 */
function parseDomPath(path: string): Array<{ text: string; isTestId: boolean }> {
  const segments: Array<{ text: string; isTestId: boolean }> = [];
  const parts = path.split(' > ');

  parts.forEach((part, index) => {
    // Check if this part contains a testid attribute
    const hasTestId = /\[data-testid[^\]]*\]|\[data-cy[^\]]*\]|\[data-test-id[^\]]*\]/.test(part);

    if (hasTestId) {
      // Split the part to highlight only the testid attribute
      const match = part.match(
        /^(.*)(\[data-test(?:id|-id)\s*=\s*["'][^"']*["']\]|\[data-cy\s*=\s*["'][^"']*["']\])(.*)$/
      );

      if (match) {
        const [, before, testidAttr, after] = match;

        // Add the part before testid (if any)
        if (before) {
          segments.push({ text: before, isTestId: false });
        }

        // Add the testid attribute in orange
        segments.push({ text: testidAttr, isTestId: true });

        // Add the part after testid (if any)
        if (after) {
          segments.push({ text: after, isTestId: false });
        }
      } else {
        // Fallback: highlight the entire part if regex didn't match as expected
        segments.push({ text: part, isTestId: true });
      }
    } else {
      // No testid, add as regular text
      segments.push({ text: part, isTestId: false });
    }

    // Add separator between elements (except after last one)
    if (index < parts.length - 1) {
      segments.push({ text: ' > ', isTestId: false });
    }
  });

  return segments;
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

  // Parse the path to identify testid segments
  const segments = parseDomPath(domPath);

  return (
    <div
      className={styles.tooltip}
      data-inspector-tooltip="true"
      data-testid={testIds.devTools.fullScreen.domPathTooltip}
      style={{
        left: `${position.x + OFFSET_X}px`,
        top: `${position.y + OFFSET_Y}px`,
      }}
    >
      {segments.map((segment, index) => (
        <span key={index} className={segment.isTestId ? styles.testidHighlight : undefined}>
          {segment.text}
        </span>
      ))}
    </div>
  );
}
