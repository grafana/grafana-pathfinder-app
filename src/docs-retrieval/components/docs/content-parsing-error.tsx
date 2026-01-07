import React, { useState, useCallback } from 'react';
import { Button, Alert, IconButton } from '@grafana/ui';

import { ParseError } from '../../content.types';

export interface ContentParsingErrorProps {
  errors: ParseError[];
  warnings?: string[];
  fallbackHtml?: string;
  onRetry?: () => void;
  className?: string;
}

export function ContentParsingError({ errors, warnings, fallbackHtml, onRetry, className }: ContentParsingErrorProps) {
  const [showDetails, setShowDetails] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopyHtml = useCallback(() => {
    if (fallbackHtml) {
      navigator.clipboard.writeText(fallbackHtml).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  }, [fallbackHtml]);

  return (
    <div className={`content-parsing-error ${className || ''}`}>
      <Alert severity="error" title="Content parsing failed">
        <p>
          The content could not be parsed into React components. This prevents interactive features from working
          properly.
        </p>

        <div className="error-summary">
          <strong>{errors.length} error(s) found:</strong>
          <ul>
            {errors.slice(0, 3).map((error, index) => (
              <li key={index}>
                <strong>{error.type}:</strong> {error.message}
                {error.location && <em> (at {error.location})</em>}
              </li>
            ))}
            {errors.length > 3 && (
              <li>
                <em>... and {errors.length - 3} more errors</em>
              </li>
            )}
          </ul>
        </div>

        {warnings && warnings.length > 0 && (
          <div className="warning-summary">
            <strong>{warnings.length} warning(s):</strong>
            <ul>
              {warnings.slice(0, 2).map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
              {warnings.length > 2 && (
                <li>
                  <em>... and {warnings.length - 2} more warnings</em>
                </li>
              )}
            </ul>
          </div>
        )}

        <div className="error-actions">
          <Button onClick={() => setShowDetails(!showDetails)} variant="secondary" size="sm">
            {showDetails ? 'Hide details' : 'Show details'}
          </Button>
          {onRetry && (
            <Button onClick={onRetry} variant="primary" size="sm">
              Retry Parsing
            </Button>
          )}
        </div>

        {showDetails && (
          <details className="error-details" open>
            <summary>Detailed error information</summary>

            {/* Show HTML content first and prominently for easier debugging */}
            {fallbackHtml && (
              <div className="html-content-section" style={{ marginBottom: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <strong>HTML content:</strong>
                  <IconButton
                    name={copied ? 'check' : 'copy'}
                    tooltip={copied ? 'Copied!' : 'Copy to clipboard'}
                    onClick={handleCopyHtml}
                    size="sm"
                  />
                </div>
                <pre
                  style={{
                    backgroundColor: 'var(--background-secondary, #1e1e1e)',
                    padding: '12px',
                    borderRadius: '4px',
                    overflow: 'auto',
                    maxHeight: '400px',
                    fontSize: '12px',
                    lineHeight: '1.4',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  <code>{fallbackHtml}</code>
                </pre>
              </div>
            )}

            {errors.map((error, index) => (
              <div key={index} className="error-detail">
                <h4>
                  Error #{index + 1}: {error.type}
                </h4>
                <p>
                  <strong>Message:</strong> {error.message}
                </p>
                {error.location && (
                  <p>
                    <strong>Location:</strong> {error.location}
                  </p>
                )}
                {error.element && (
                  <details>
                    <summary>Problem element</summary>
                    <pre>
                      <code>{error.element}</code>
                    </pre>
                  </details>
                )}
                {error.originalError && (
                  <p>
                    <strong>Original error:</strong> {error.originalError.message}
                  </p>
                )}
              </div>
            ))}
          </details>
        )}
      </Alert>
    </div>
  );
}
