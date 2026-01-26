import React, { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import { Box, Button, Icon, Input, Select, useStyles2 } from '@grafana/ui';
import { SelectableValue } from '@grafana/data';
import { getPrTesterStyles } from './pr-tester.styles';
import { fetchPrContentFilesFromUrl, isValidPrUrl, type PrContentFile } from './github-api';

const PR_URL_STORAGE_KEY = 'pathfinder-pr-tester-url';
const SELECTED_FILE_STORAGE_KEY = 'pathfinder-pr-tester-selected';

export interface PrTesterProps {
  onOpenDocsPage: (url: string, title: string) => void;
}

type FetchState = 'idle' | 'fetching' | 'fetched' | 'error';

/**
 * PR Tester component for testing content.json files from GitHub PRs
 *
 * Two-step interaction:
 * 1. User pastes PR URL and clicks "Fetch PR" to retrieve file list
 * 2. User selects a file (if multiple) and clicks "Test guide"
 */
export function PrTester({ onOpenDocsPage }: PrTesterProps) {
  const styles = useStyles2(getPrTesterStyles);

  // PR URL input (persisted to localStorage)
  const [prUrl, setPrUrl] = useState(() => {
    try {
      return localStorage.getItem(PR_URL_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });

  // Fetch state
  const [fetchState, setFetchState] = useState<FetchState>('idle');
  const [files, setFiles] = useState<PrContentFile[]>([]);
  const [error, setError] = useState<string | null>(null);

  // User's explicit file selection (only set when user changes selection)
  const [userSelectedFile, setUserSelectedFile] = useState<string | null>(() => {
    try {
      return localStorage.getItem(SELECTED_FILE_STORAGE_KEY);
    } catch {
      return null;
    }
  });

  // Success feedback for test action
  const [testSuccess, setTestSuccess] = useState(false);

  // REACT: refs for cleanup on unmount (R1, R4)
  const abortControllerRef = useRef<AbortController>();
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Cancel any in-flight fetch request
      abortControllerRef.current?.abort();
      // Clear any pending success message timeout
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
    };
  }, []);

  // Persist PR URL to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(PR_URL_STORAGE_KEY, prUrl);
    } catch {
      // Ignore localStorage errors
    }
  }, [prUrl]);

  // Persist selected file to localStorage
  useEffect(() => {
    try {
      if (userSelectedFile) {
        localStorage.setItem(SELECTED_FILE_STORAGE_KEY, userSelectedFile);
      }
    } catch {
      // Ignore localStorage errors
    }
  }, [userSelectedFile]);

  // Compute effective selected file: user selection if valid, otherwise first file
  // This avoids calling setState in useEffect which causes cascading renders
  const selectedFile = useMemo(() => {
    if (files.length === 0) {
      return null;
    }
    // Use user selection if it exists in current files
    if (userSelectedFile && files.some((f) => f.directoryName === userSelectedFile)) {
      return userSelectedFile;
    }
    // Default to first file
    return files[0].directoryName;
  }, [files, userSelectedFile]);

  // Build select options from files
  const fileOptions: Array<SelectableValue<string>> = useMemo(
    () =>
      files.map((file) => ({
        value: file.directoryName,
        label: file.directoryName,
        description: file.status,
      })),
    [files]
  );

  // Get currently selected file object
  const currentFile = useMemo(() => files.find((f) => f.directoryName === selectedFile), [files, selectedFile]);

  // Handle fetch PR action
  const handleFetchPr = useCallback(async () => {
    const cleanedUrl = prUrl.trim();

    if (!isValidPrUrl(cleanedUrl)) {
      setError('Invalid PR URL. Expected format: github.com/owner/repo/pull/123');
      setFetchState('error');
      return;
    }

    // REACT: abort any in-flight request before starting new one (R4, R7)
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();

    setFetchState('fetching');
    setError(null);
    setFiles([]);

    const result = await fetchPrContentFilesFromUrl(cleanedUrl, abortControllerRef.current.signal);

    // Ignore aborted results - component may have unmounted or URL changed
    if (!result.success && result.error.type === 'aborted') {
      return;
    }

    if (result.success) {
      setFiles(result.files);
      setFetchState('fetched');
    } else {
      setError(result.error.message);
      setFetchState('error');
    }
  }, [prUrl]);

  // Handle test guide action
  const handleTestGuide = useCallback(() => {
    if (!currentFile) {
      return;
    }

    onOpenDocsPage(currentFile.rawUrl, currentFile.directoryName);
    setTestSuccess(true);

    // REACT: track timeout for cleanup on unmount (R1)
    successTimeoutRef.current = setTimeout(() => setTestSuccess(false), 2000);
  }, [currentFile, onOpenDocsPage]);

  // Handle URL input change - reset state when URL changes
  const handleUrlChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setPrUrl(e.currentTarget.value);
    setFetchState('idle');
    setError(null);
    setFiles([]);
    setTestSuccess(false);
  }, []);

  // Handle file selection change
  const handleFileSelect = useCallback((option: SelectableValue<string>) => {
    if (option.value) {
      setUserSelectedFile(option.value);
    }
  }, []);

  // Get status badge class
  const getStatusClass = (status: PrContentFile['status']) => {
    switch (status) {
      case 'added':
        return `${styles.statusBadge} ${styles.statusAdded}`;
      case 'modified':
        return `${styles.statusBadge} ${styles.statusModified}`;
      default:
        return styles.statusBadge;
    }
  };

  const isFetching = fetchState === 'fetching';
  const hasFetched = fetchState === 'fetched';
  const hasMultipleFiles = files.length > 1;
  const hasSingleFile = files.length === 1;

  return (
    <div className={styles.formGroup}>
      {/* PR URL Input */}
      <label className={styles.label} htmlFor="prTesterInput">
        PR URL
      </label>
      <Input
        id="prTesterInput"
        className={styles.urlInput}
        value={prUrl}
        onChange={handleUrlChange}
        placeholder="https://github.com/grafana/interactive-tutorials/pull/70"
      />
      <p className={styles.helpText}>Paste a GitHub pull request URL. We will look for content.json files.</p>

      {/* Fetch PR Button */}
      <Box marginTop={1}>
        <Button
          variant="primary"
          size="sm"
          onClick={handleFetchPr}
          disabled={!prUrl.trim() || isFetching}
          icon={isFetching ? 'fa fa-spinner' : undefined}
        >
          {isFetching ? 'Fetching...' : 'Fetch PR'}
        </Button>
      </Box>

      {/* File Selection (when multiple files) */}
      {hasFetched && hasMultipleFiles && (
        <div className={styles.selectContainer}>
          <label className={styles.label}>Guide to test</label>
          <Select
            options={fileOptions}
            value={fileOptions.find((o) => o.value === selectedFile)}
            onChange={handleFileSelect}
            formatOptionLabel={(option) => (
              <span>
                {option.label}
                {option.description && (
                  <span className={getStatusClass(option.description as PrContentFile['status'])}>
                    {option.description}
                  </span>
                )}
              </span>
            )}
          />
        </div>
      )}

      {/* Ready Text (when single file) */}
      {hasFetched && hasSingleFile && currentFile && (
        <div className={styles.readyText}>
          <Icon name="check" />
          Ready: {currentFile.directoryName}
          <span className={getStatusClass(currentFile.status)}>{currentFile.status}</span>
        </div>
      )}

      {/* Test Guide Button */}
      {hasFetched && (
        <Box marginTop={1}>
          <Button variant="secondary" size="sm" onClick={handleTestGuide} disabled={!currentFile}>
            Test guide
          </Button>
        </Box>
      )}

      {/* Error Message */}
      {error && (
        <div className={`${styles.resultBox} ${styles.resultError}`}>
          <p className={styles.resultText}>
            <Icon name="exclamation-triangle" /> {error}
          </p>
        </div>
      )}

      {/* Success Message */}
      {testSuccess && (
        <div className={`${styles.resultBox} ${styles.resultSuccess}`}>
          <p className={styles.resultText}>
            <Icon name="check" /> Opened in new tab
          </p>
        </div>
      )}
    </div>
  );
}
