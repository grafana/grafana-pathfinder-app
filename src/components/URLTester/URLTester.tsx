import { Button, Icon, Input, useStyles2 } from '@grafana/ui';
import React, { useCallback, useEffect, useState } from 'react';
import { getURLTesterStyles } from './url-tester.styles';
import {
  isGitHubRawUrl,
  isInteractiveLearningUrl,
  isGrafanaDocsUrl,
  isLocalhostUrl,
  type URLValidation,
} from '../../security';

const STORAGE_KEY = 'pathfinder-url-tester-url';

export interface URLTesterProps {
  onOpenDocsPage: (url: string, title: string) => void;
}

/**
 * Unified URL validator for the dev panel
 * Accepts all supported content URLs:
 * - Interactive learning domains (interactive-learning.grafana.net, etc.)
 * - GitHub raw URLs (raw.githubusercontent.com)
 * - Grafana docs URLs (grafana.com/docs)
 * - Localhost URLs (for local testing)
 *
 * Note: This validator is used in the URLTester which is only visible in dev mode,
 * so we allow all dev-mode URLs without checking isDevModeEnabledGlobal().
 */
function validateContentUrl(url: string): URLValidation {
  if (!url) {
    return {
      isValid: false,
      errorMessage: 'Please provide a URL',
    };
  }

  try {
    new URL(url);
  } catch {
    return {
      isValid: false,
      errorMessage: 'Invalid URL format',
    };
  }

  // Accept all supported content sources
  if (isInteractiveLearningUrl(url)) {
    return { isValid: true };
  }

  if (isGitHubRawUrl(url)) {
    return { isValid: true };
  }

  if (isGrafanaDocsUrl(url)) {
    return { isValid: true };
  }

  if (isLocalhostUrl(url)) {
    return { isValid: true };
  }

  return {
    isValid: false,
    errorMessage:
      'URL must be from: interactive-learning.grafana.net, raw.githubusercontent.com, grafana.com/docs, or localhost',
  };
}

export const URLTester = ({ onOpenDocsPage }: URLTesterProps) => {
  const styles = useStyles2(getURLTesterStyles);
  const [testUrl, setTestUrl] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [testError, setTestError] = useState<string | null>(null);
  const [testSuccess, setTestSuccess] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, testUrl);
    } catch {}
  }, [testUrl]);

  const handleSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const cleanedUrl = testUrl.trim();
      const validation = validateContentUrl(cleanedUrl);

      if (!validation.isValid) {
        setTestError(validation.errorMessage || 'Invalid URL format');
        setTestSuccess(false);
        return;
      }

      if (!onOpenDocsPage) {
        setTestError('Tab opening is not available');
        return;
      }

      const tutorialName = extractTitleFromUrl(url);

      onOpenDocsPage(url, tutorialName);
      setTestSuccess(true);
      setTestError(null);

      setTimeout(() => setTestSuccess(false), 2000);
    },
    [testUrl, onOpenDocsPage]
  );

  return (
    <form className={styles.formGroup} onSubmit={handleSubmit}>
      <label className={styles.label} htmlFor="urlTesterInput">
        URL to test
      </label>
      <Input
        className={styles.selectorInput}
        value={testUrl}
        id="url"
        onChange={(e) => {
          setTestUrl(e.currentTarget.value);
          setTestError(null);
          setTestSuccess(false);
        }}
        placeholder="https://interactive-learning.grafana.net/tutorial-name"
      />
      <p className={styles.helpText}>
        Supported URLs: interactive-learning.grafana.net, raw.githubusercontent.com, grafana.com/docs, localhost
      </p>
      <Box marginTop={1}>
        <Button variant="primary" size="sm" type="submit" disabled={!testUrl.trim() || !onOpenDocsPage}>
          Test URL
        </Button>
      </Box>

      {testError && (
        <div className={`${styles.resultBox} ${styles.resultError}`}>
          <p className={styles.resultText}>
            <Icon name="exclamation-triangle" /> {testError}
          </p>
        </div>
      )}

      {testSuccess && (
        <div className={`${styles.resultBox} ${styles.resultSuccess}`}>
          <p className={styles.resultText}>
            <Icon name="check" />
            Opened in new tab
          </p>
        </div>
      )}
    </form>
  );
};

function extractTitleFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    const pathSegments = urlObj.pathname.split('/').filter(Boolean);
    const lastPart = pathSegments[pathSegments.length - 1];

    if (lastPart === 'unstyled.html' || lastPart === 'content.json') {
      return pathSegments[pathSegments.length - 2] || 'Tutorial';
    }

    return lastPart || 'Tutorial';
  } catch {
    return 'Tutorial';
  }
}
