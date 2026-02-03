/**
 * BlockEditorHeader Component
 *
 * Header section of the block editor containing:
 * - Guide title and save status
 * - Settings button
 * - View mode toggle (edit/preview/json)
 * - Import/export actions
 * - New guide button
 */

import React from 'react';
import { Button, Badge, ButtonGroup } from '@grafana/ui';
import type { ViewMode } from './types';

export interface BlockEditorHeaderProps {
  /** Guide title to display */
  guideTitle: string;
  /** Whether there are unsaved changes */
  isDirty: boolean;
  /** Current view mode */
  viewMode: ViewMode;
  /** Callback to set view mode */
  onSetViewMode: (mode: ViewMode) => void;
  /** Callback to open metadata modal */
  onOpenMetadata: () => void;
  /** Callback to open tour */
  onOpenTour: () => void;
  /** Callback to open import modal */
  onOpenImport: () => void;
  /** Callback to copy JSON to clipboard */
  onCopy: () => void;
  /** Callback to download JSON */
  onDownload: () => void;
  /** Callback to open GitHub PR modal */
  onOpenGitHubPR: () => void;
  /** Callback to start new guide */
  onNewGuide: () => void;
  /** Style classes */
  styles: {
    header: string;
    headerLeft: string;
    headerRight: string;
    guideTitle: string;
    viewModeToggle: string;
  };
}

/**
 * Header component for the block editor.
 * Contains title, save status, and action buttons.
 */
export function BlockEditorHeader({
  guideTitle,
  isDirty,
  viewMode,
  onSetViewMode,
  onOpenMetadata,
  onOpenTour,
  onOpenImport,
  onCopy,
  onDownload,
  onOpenGitHubPR,
  onNewGuide,
  styles,
}: BlockEditorHeaderProps) {
  return (
    <div className={styles.header}>
      <div className={styles.headerLeft}>
        <h3 className={styles.guideTitle}>{guideTitle}</h3>
        {isDirty ? (
          <Badge text="Auto-saving..." color="orange" icon="fa fa-spinner" />
        ) : (
          <Badge text="Saved" color="green" icon="check" />
        )}
        <Button
          variant="secondary"
          size="sm"
          icon="cog"
          onClick={onOpenMetadata}
          tooltip="Edit guide settings"
          data-testid="guide-metadata-button"
        />
      </div>

      <div className={styles.headerRight}>
        {/* Tour button */}
        <Button
          variant="secondary"
          size="sm"
          icon="question-circle"
          onClick={onOpenTour}
          tooltip="Take a tour of the guide editor"
        >
          Tour
        </Button>

        {/* View mode toggle - icon only */}
        <div className={styles.viewModeToggle} data-testid="view-mode-toggle">
          <ButtonGroup>
            <Button
              variant={viewMode === 'edit' ? 'primary' : 'secondary'}
              size="sm"
              icon="pen"
              onClick={() => onSetViewMode('edit')}
              tooltip="Edit blocks"
            />
            <Button
              variant={viewMode === 'preview' ? 'primary' : 'secondary'}
              size="sm"
              icon="eye"
              onClick={() => onSetViewMode('preview')}
              tooltip="Preview"
            />
          </ButtonGroup>
        </div>

        {/* Import button */}
        <Button variant="secondary" size="sm" icon="upload" onClick={onOpenImport} tooltip="Import JSON guide" />

        {/* Export actions */}
        <Button
          variant="secondary"
          size="sm"
          icon="copy"
          onClick={onCopy}
          tooltip="Copy JSON to clipboard"
          data-testid="copy-json-button"
        />
        <Button variant="secondary" size="sm" icon="download-alt" onClick={onDownload} tooltip="Download JSON file" />
        <Button variant="secondary" size="sm" icon="github" onClick={onOpenGitHubPR} tooltip="Create GitHub PR" />
        <Button variant="secondary" size="sm" icon="file-blank" onClick={onNewGuide} tooltip="Start new guide" />
      </div>
    </div>
  );
}

BlockEditorHeader.displayName = 'BlockEditorHeader';
