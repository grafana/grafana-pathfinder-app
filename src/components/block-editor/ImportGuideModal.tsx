/**
 * Import Guide Modal
 *
 * Modal for importing JSON guide files with drag-and-drop and file picker support.
 */

import React, { useState, useCallback, useRef } from 'react';
import { Button, Modal, Alert, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css, cx } from '@emotion/css';
import type { JsonGuide } from './types';
import { importGuideFromFile, type ImportValidationResult } from './utils/block-import';

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
  }),

  dropZone: css({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing(2),
    padding: theme.spacing(4),
    border: `2px dashed ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    backgroundColor: theme.colors.background.secondary,
    transition: 'all 0.2s ease',
    cursor: 'pointer',
    minHeight: '180px',

    '&:hover': {
      borderColor: theme.colors.primary.border,
      backgroundColor: theme.colors.action.hover,
    },
  }),

  dropZoneActive: css({
    borderColor: theme.colors.primary.main,
    backgroundColor: theme.colors.primary.transparent,
    borderStyle: 'solid',
  }),

  dropZoneSuccess: css({
    borderColor: theme.colors.success.main,
    backgroundColor: theme.colors.success.transparent,
  }),

  dropZoneError: css({
    borderColor: theme.colors.error.main,
    backgroundColor: theme.colors.error.transparent,
  }),

  dropIcon: css({
    fontSize: '48px',
    opacity: 0.6,
  }),

  dropText: css({
    color: theme.colors.text.secondary,
    textAlign: 'center',
  }),

  dropTextPrimary: css({
    fontSize: theme.typography.body.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
    marginBottom: theme.spacing(0.5),
  }),

  dropTextSecondary: css({
    fontSize: theme.typography.bodySmall.fontSize,
  }),

  hiddenInput: css({
    display: 'none',
  }),

  fileInfo: css({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: theme.spacing(1),
  }),

  fileName: css({
    fontSize: theme.typography.body.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
    wordBreak: 'break-all',
  }),

  guideInfo: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),

  errorList: css({
    margin: 0,
    paddingLeft: theme.spacing(2),
    fontSize: theme.typography.bodySmall.fontSize,

    '& li': {
      marginBottom: theme.spacing(0.5),
    },
  }),

  warningList: css({
    margin: 0,
    paddingLeft: theme.spacing(2),
    fontSize: theme.typography.bodySmall.fontSize,
  }),

  footer: css({
    display: 'flex',
    justifyContent: 'flex-end',
    gap: theme.spacing(1),
    paddingTop: theme.spacing(2),
    borderTop: `1px solid ${theme.colors.border.weak}`,
    marginTop: theme.spacing(1),
  }),

  resetButton: css({
    marginRight: 'auto',
  }),
});

export interface ImportGuideModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Called when a valid guide is imported */
  onImport: (guide: JsonGuide) => void;
  /** Called to close the modal */
  onClose: () => void;
  /** Whether there are unsaved changes that would be lost */
  hasUnsavedChanges?: boolean;
}

interface ImportState {
  file: File | null;
  result: ImportValidationResult | null;
  isDragging: boolean;
  isProcessing: boolean;
}

export function ImportGuideModal({ isOpen, onImport, onClose, hasUnsavedChanges = false }: ImportGuideModalProps) {
  const styles = useStyles2(getStyles);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false);
  const [state, setState] = useState<ImportState>({
    file: null,
    result: null,
    isDragging: false,
    isProcessing: false,
  });

  // Process file
  const processFile = useCallback(async (file: File) => {
    setState((prev) => ({ ...prev, isProcessing: true }));

    const result = await importGuideFromFile(file);

    setState({
      file,
      result,
      isDragging: false,
      isProcessing: false,
    });
  }, []);

  // Handle file input change
  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        processFile(file);
      }
    },
    [processFile]
  );

  // Handle drop zone click
  const handleDropZoneClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // Handle drag events
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setState((prev) => ({ ...prev, isDragging: true }));
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setState((prev) => ({ ...prev, isDragging: false }));
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const file = e.dataTransfer.files?.[0];
      if (file) {
        processFile(file);
      } else {
        setState((prev) => ({ ...prev, isDragging: false }));
      }
    },
    [processFile]
  );

  // Handle reset
  const handleReset = useCallback(() => {
    setState({
      file: null,
      result: null,
      isDragging: false,
      isProcessing: false,
    });
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  // Handle import click
  const handleImportClick = useCallback(() => {
    if (hasUnsavedChanges && !showUnsavedWarning) {
      setShowUnsavedWarning(true);
      return;
    }

    if (state.result?.guide) {
      onImport(state.result.guide);
      handleReset();
      setShowUnsavedWarning(false);
    }
  }, [hasUnsavedChanges, showUnsavedWarning, state.result, onImport, handleReset]);

  // Handle close
  const handleClose = useCallback(() => {
    handleReset();
    setShowUnsavedWarning(false);
    onClose();
  }, [onClose, handleReset]);

  // Determine drop zone state
  const getDropZoneClassName = () => {
    return cx(styles.dropZone, {
      [styles.dropZoneActive]: state.isDragging,
      [styles.dropZoneSuccess]: state.result?.isValid,
      [styles.dropZoneError]: state.result && !state.result.isValid,
    });
  };

  // Render drop zone content
  const renderDropZoneContent = () => {
    if (state.isProcessing) {
      return (
        <>
          <span className={styles.dropIcon}>⏳</span>
          <div className={styles.dropText}>
            <div className={styles.dropTextPrimary}>Processing...</div>
          </div>
        </>
      );
    }

    if (state.result?.isValid && state.file) {
      return (
        <div className={styles.fileInfo}>
          <span className={styles.dropIcon}>✅</span>
          <div className={styles.fileName}>{state.file.name}</div>
          <div className={styles.guideInfo}>
            {state.result.guide?.title} • {state.result.guide?.blocks.length} blocks
          </div>
        </div>
      );
    }

    if (state.result && !state.result.isValid && state.file) {
      return (
        <div className={styles.fileInfo}>
          <span className={styles.dropIcon}>❌</span>
          <div className={styles.fileName}>{state.file.name}</div>
          <div className={styles.dropText}>
            <div className={styles.dropTextSecondary}>Click to choose a different file</div>
          </div>
        </div>
      );
    }

    return (
      <>
        <span className={styles.dropIcon}>📂</span>
        <div className={styles.dropText}>
          <div className={styles.dropTextPrimary}>Drag and drop a JSON guide file here</div>
          <div className={styles.dropTextSecondary}>or click to browse files</div>
        </div>
      </>
    );
  };

  return (
    <Modal title="Import Guide" isOpen={isOpen} onDismiss={handleClose}>
      <div className={styles.container}>
        {/* Drop zone */}
        <div
          className={getDropZoneClassName()}
          onClick={handleDropZoneClick}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          role="button"
          tabIndex={0}
          aria-label="Drop zone for JSON file upload"
        >
          {renderDropZoneContent()}
        </div>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          onChange={handleFileChange}
          className={styles.hiddenInput}
          aria-hidden="true"
        />

        {/* Validation errors */}
        {state.result && !state.result.isValid && state.result.errors.length > 0 && (
          <Alert title="Validation Failed" severity="error">
            <ul className={styles.errorList}>
              {state.result.errors.map((error, index) => (
                <li key={index}>{error}</li>
              ))}
            </ul>
          </Alert>
        )}

        {/* Warnings */}
        {state.result?.isValid && state.result.warnings.length > 0 && (
          <Alert title="Warnings" severity="warning">
            <ul className={styles.warningList}>
              {state.result.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          </Alert>
        )}

        {/* Unsaved changes warning */}
        {showUnsavedWarning && (
          <Alert title="Unsaved Changes" severity="warning">
            You have unsaved changes that will be lost. Click Import again to confirm.
          </Alert>
        )}

        {/* Footer */}
        <div className={styles.footer}>
          {state.file && (
            <Button variant="secondary" onClick={handleReset} className={styles.resetButton}>
              Choose Different File
            </Button>
          )}
          <Button variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleImportClick} disabled={!state.result?.isValid}>
            {showUnsavedWarning ? 'Confirm Import' : 'Import'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
