import React, { useState } from 'react';
import { Button, Alert } from '@grafana/ui';

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

  return (
    <div className={`content-parsing-error ${className || ''}`}>
      <Alert severity="error" title="Content Parsing Failed">
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
            {showDetails ? 'Hide Details' : 'Show Details'}
          </Button>
          {onRetry && (
            <Button onClick={onRetry} variant="primary" size="sm">
              Retry Parsing
            </Button>
          )}
        </div>

        {showDetails && (
          <details className="error-details">
            <summary>Detailed Error Information</summary>
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
                    <summary>Problem Element</summary>
                    <pre>
                      <code>{error.element}</code>
                    </pre>
                  </details>
                )}
                {error.originalError && (
                  <p>
                    <strong>Original Error:</strong> {error.originalError.message}
                  </p>
                )}
              </div>
            ))}

            {fallbackHtml && (
              <details>
                <summary>Original HTML Content</summary>
                <pre>
                  <code>{fallbackHtml.substring(0, 1000)}</code>
                </pre>
                {fallbackHtml.length > 1000 && (
                  <p>
                    <em>... truncated</em>
                  </p>
                )}
              </details>
            )}
          </details>
        )}
      </Alert>
    </div>
  );
}
