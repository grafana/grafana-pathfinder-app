/**
 * Pop out / Full screen action buttons rendered in the sidebar header.
 *
 * Both buttons fire panel-mode-coordination events (`pathfinder-request-pop-out`
 * and `pathfinder-request-full-screen`) handled by the matching listeners in
 * `docs-panel.tsx`. Extracted from two near-identical inline blocks so the
 * two header rows (docs-like header and journey milestone-bar header) cannot
 * drift on copy, aria-label, test id, or behavior.
 *
 * The `className` prop is supplied by each header so the buttons inherit the
 * surrounding `secondaryActionButton` style without duplicating the styling
 * here.
 */

import React from 'react';
import { Icon } from '@grafana/ui';

import { testIds } from '../../../constants/testIds';

export interface PanelModeActionButtonsProps {
  /** className applied to both buttons (typically the header's `secondaryActionButton`). */
  className: string;
}

export function PanelModeActionButtons({ className }: PanelModeActionButtonsProps) {
  return (
    <>
      <button
        className={className}
        aria-label="Pop out to floating panel"
        title="Pop out guide to a floating panel"
        data-testid={testIds.docsPanel.popOutButton}
        onClick={() => {
          document.dispatchEvent(new CustomEvent('pathfinder-request-pop-out'));
        }}
      >
        <Icon name="corner-up-right" size="sm" />
        <span>Pop out</span>
      </button>
      <button
        className={className}
        aria-label="Open in full screen"
        title="Open guide in full screen"
        data-testid={testIds.docsPanel.fullScreenButton}
        onClick={() => {
          document.dispatchEvent(new CustomEvent('pathfinder-request-full-screen'));
        }}
      >
        <Icon name="expand-arrows" size="sm" />
        <span>Full screen</span>
      </button>
    </>
  );
}
