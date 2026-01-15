import { Box, Button, Icon, Input, useStyles2 } from '@grafana/ui';
import React, { useCallback, useEffect, useState } from 'react';
import { getUrlTesterStyles } from './url-tester.styles';
import { type UrlValidation } from '../../security';

const STORAGE_KEY = 'pathfinder-url-tester-url';

export interface UrlTesterProps {
  onOpenDocsPage: (url: string, title: string) => void;
}

/**
 * URL validator for the dev panel.
 *
 * WARNING! This function must only be used for dev mode url testing, it bypasses all security checks.
 */
function validateContentUrl(url: string): UrlValidation {
  if (!url) {
    return {
      isValid: false,
      errorMessage: 'Must provide a URL',
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

  return { isValid: true };
}

export const UrlTester = ({ onOpenDocsPage }: UrlTesterProps) => {
  const styles = useStyles2(getUrlTesterStyles);
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

      const tutorialName = extractTitleFromUrl(testUrl);

      onOpenDocsPage(testUrl, tutorialName);
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
      <p className={styles.helpText}>Only enter trusted URLs.</p>
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
