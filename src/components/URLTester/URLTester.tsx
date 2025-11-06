import { Box, Button, Icon, Input, Tab, TabContent, TabsBar, useStyles2 } from '@grafana/ui';
import React, { PropsWithChildren, useCallback, useState } from 'react';
import { getURLTesterStyles } from './url-tester.styles';
import { validateGitHubUrl, validateTutorialUrl } from '../../security';

export interface URLTesterProps {
  onOpenDocsPage: (url: string, title: string) => void;
}

export const URLTester = ({ onOpenDocsPage }: URLTesterProps) => {
  const styles = useStyles2(getURLTesterStyles);
  const [activeTab, setActiveTab] = useState('github');

  return (
    <div>
      <TabsBar>
        <Tab label="GitHub" value="github" active={activeTab === 'github'} onChangeTab={() => setActiveTab('github')} />
        <Tab label="Other" value="other" active={activeTab === 'other'} onChangeTab={() => setActiveTab('other')} />
      </TabsBar>
      <TabContent>
        <Box paddingY={2}>
          {activeTab === 'github' && (
            <URLTesterContent
              onOpenDocsPage={onOpenDocsPage}
              placeholder="https://github.com/grafana/interactive-tutorials/tree/main/explore-drilldowns-101"
              validator={validateGitHubUrl}
            >
              <p className={styles.helpText}>
                Provide a GitHub tree URL pointing to a tutorial directory.
                <br />
                The URL should be in format: github.com/{'{owner}'}/{'{repo}'}/tree/{'{branch}'}/{'{path}'}
              </p>
            </URLTesterContent>
          )}
          {activeTab === 'other' && (
            <URLTesterContent
              onOpenDocsPage={onOpenDocsPage}
              placeholder="http://127.0.0.1:5500/interactive-tutorials/tree/main/explore-drilldowns-101/unstyled.html"
              validator={validateTutorialUrl}
            >
              <p className={styles.helpText}>
                Provide a URL pointing to a tutorial page. Make sure to include the /unstyled.html suffix.
              </p>
            </URLTesterContent>
          )}
        </Box>
      </TabContent>
    </div>
  );
};

interface URLTesterContentProps extends PropsWithChildren {
  onOpenDocsPage: (url: string, title: string) => void;
  placeholder?: string;
  validator?: (url: string) => { isValid: boolean; errorMessage?: string };
}

const URLTesterContent = ({ children, onOpenDocsPage, placeholder, validator }: URLTesterContentProps) => {
  const styles = useStyles2(getURLTesterStyles);
  const [testUrl, setTestUrl] = useState('');
  const [testError, setTestError] = useState<string | null>(null);
  const [testSuccess, setTestSuccess] = useState(false);

  // GitHub Tutorial Tester Handler
  const handleSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const cleanedUrl = testUrl.trim();
      const validation = validator?.(cleanedUrl);

      if (validation && !validation?.isValid) {
        setTestError(validation?.errorMessage || 'Invalid URL format');
        setTestSuccess(false);
        return;
      }

      if (!onOpenDocsPage) {
        setTestError('Tab opening is not available');
        return;
      }

      const tutorialName = extractTitleFromUrl(cleanedUrl);

      // Open in new tab with tutorial name as title
      onOpenDocsPage(cleanedUrl, tutorialName);
      setTestSuccess(true);
      setTestError(null);

      // Reset success state after 2 seconds
      setTimeout(() => setTestSuccess(false), 2000);
    },
    [testUrl, onOpenDocsPage, validator]
  );

  return (
    <form className={styles.formGroup} onSubmit={handleSubmit}>
      <label className={styles.label} htmlFor="urlTesterInput">
        URL to Test
      </label>
      <Input
        className={styles.selectorInput}
        value={testUrl}
        id="urlTesterInput"
        onChange={(e) => {
          setTestUrl(e.currentTarget.value);
          setTestError(null);
          setTestSuccess(false);
        }}
        placeholder={placeholder}
      />
      {children}
      <Button
        variant="primary"
        size="sm"
        type="submit"
        disabled={!testUrl.trim() || !onOpenDocsPage}
        icon="external-link-alt"
      >
        Test Tutorial in New Tab
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
            <Icon name="check" /> Tutorial opened in new tab!
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
