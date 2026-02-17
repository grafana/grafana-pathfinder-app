/**
 * Error display component for docs-panel content errors.
 * Shows an error alert with optional retry functionality.
 */

import React from 'react';
import { Alert, Button } from '@grafana/ui';
import { t } from '@grafana/i18n';
import { testIds } from '../../testIds';

export interface ErrorDisplayProps {
  /** The error message to display */
  error: string;
  /** The type of content that failed to load */
  contentType: 'documentation' | 'learning-journey';
  /** CSS class name for the container */
  className?: string;
  /** Callback for retry action - if provided, shows retry button for retryable errors */
  onRetry?: () => void;
}

/**
 * Determines if an error is retryable based on the error message.
 */
const isRetryableError = (error: string): boolean => {
  return error.includes('timeout') || error.includes('Unable to connect') || error.includes('network');
};

/**
 * Displays an error state for docs-panel content with optional retry.
 * Shows different messages based on content type and error retryability.
 */
export const ErrorDisplay: React.FC<ErrorDisplayProps> = ({ error, contentType, className, onRetry }) => {
  const isRetryable = isRetryableError(error);
  const contentTypeLabel = contentType === 'documentation' ? 'documentation' : 'learning path';

  return (
    <div className={className} data-testid={testIds.docsPanel.errorState}>
      <Alert severity="error" title={`Unable to load ${contentTypeLabel}`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <p>{error}</p>
          {isRetryable && onRetry && (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <Button size="sm" variant="secondary" onClick={onRetry}>
                {t('docsPanel.retry', 'Retry')}
              </Button>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                {t('docsPanel.retryHint', 'Check your connection and try again')}
              </span>
            </div>
          )}
        </div>
      </Alert>
    </div>
  );
};
