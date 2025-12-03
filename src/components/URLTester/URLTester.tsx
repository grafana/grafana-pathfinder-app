import { Button, Icon, Input, useStyles2 } from '@grafana/ui';
import React, { useCallback, useState } from 'react';
import { getURLTesterStyles } from './url-tester.styles';
import { validateGitHubUrl, validateTutorialUrl } from '../../security';

export interface URLTesterProps {
  onOpenDocsPage: (url: string, title: string) => void;
}

export const URLTester = ({ onOpenDocsPage }: URLTesterProps) => {
  const styles = useStyles2(getURLTesterStyles);
  const [testUrl, setTestUrl] = useState('');
  const [testError, setTestError] = useState<string | null>(null);
  const [testSuccess, setTestSuccess] = useState(false);

  const handleSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      let url = testUrl.trim();
      const githubValidation = validateGitHubUrl(url);

      if (!githubValidation.isValid) {
        const tutorialValidation = validateTutorialUrl(url);

        if (!tutorialValidation.isValid) {
          setTestError(`Invalid URL format. Must be the GitHub URL of an interactive guide or a documentation page.`);
          setTestSuccess(false);
          return;
        }
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
      <label className={styles.label} htmlFor="url">
        URL
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
        placeholder="https://github.com/grafana/interactive-tutorials/tree/main/explore-drilldowns-101"
      />
      <p className={styles.helpText}>
        Provide a GitHub interactive guide or documentation page.
        <br />
        GitHub format: https://github.com/{'{owner}'}/{'{repo}'}/tree/{'{branch}'}/{'{path}'}
        <br />
        Documentation page format: http://localhost:3002/{'{path}'}
      </p>
      <Button
        variant="primary"
        size="sm"
        type="submit"
        disabled={!testUrl.trim() || !onOpenDocsPage}
        icon="external-link-alt"
      >
        Test
      </Button>

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

    if (lastPart === `unstyled.html`) {
      return pathSegments[pathSegments.length - 2];
    }

    return lastPart;
  } catch (error) {
    return 'Documentation';
  }
}
