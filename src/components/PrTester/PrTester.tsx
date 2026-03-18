import React, { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import { Box, Button, Icon, Input, Combobox, useStyles2, RadioButtonGroup, type ComboboxOption } from '@grafana/ui';
import { SelectableValue } from '@grafana/data';
import { getPrTesterStyles } from './pr-tester.styles';
import { fetchPrContentFilesFromUrl, isValidPrUrl, type PrContentFile } from './github-api';

const PR_URL_STORAGE_KEY = 'pathfinder-pr-tester-url';
const SELECTED_FILE_STORAGE_KEY = 'pathfinder-pr-tester-selected';
const TEST_MODE_STORAGE_KEY = 'pathfinder-pr-tester-mode';
const FETCHED_FILES_STORAGE_KEY = 'pathfinder-pr-tester-files';
const FETCHED_URL_STORAGE_KEY = 'pathfinder-pr-tester-fetched-url';
const ORDERED_FILES_STORAGE_KEY = 'pathfinder-pr-tester-ordered-files';

export interface PrTesterProps {
  onOpenDocsPage: (url: string, title: string) => void;
  onOpenLearningJourney?: (url: string, title: string) => void;
}

type FetchState = 'idle' | 'fetching' | 'fetched' | 'error';
type TestMode = 'single' | 'all' | 'path';

/**
 * PR Tester component for testing content.json files from GitHub PRs
 *
 * Supports three modes:
 * 1. Single - Test one guide at a time
 * 2. Open All - Open all guides from the PR in separate tabs
 * 3. Learning Path - Create an ordered learning path for sequential testing
 */
export function PrTester({ onOpenDocsPage, onOpenLearningJourney }: PrTesterProps) {
  const styles = useStyles2(getPrTesterStyles);

  // PR URL input (persisted to localStorage)
  const [prUrl, setPrUrl] = useState(() => {
    try {
      return localStorage.getItem(PR_URL_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });

  // Test mode selection (persisted to localStorage)
  const [testMode, setTestMode] = useState<TestMode>(() => {
    try {
      return (localStorage.getItem(TEST_MODE_STORAGE_KEY) as TestMode) || 'single';
    } catch {
      return 'single';
    }
  });

  // Fetch state
  const [fetchState, setFetchState] = useState<FetchState>('idle');
  const [files, setFiles] = useState<PrContentFile[]>(() => {
    // Try to restore files from localStorage
    try {
      const storedFiles = localStorage.getItem(FETCHED_FILES_STORAGE_KEY);
      const storedUrl = localStorage.getItem(FETCHED_URL_STORAGE_KEY);
      const currentUrl = localStorage.getItem(PR_URL_STORAGE_KEY);

      // Only restore if the URL matches
      if (storedFiles && storedUrl === currentUrl) {
        return JSON.parse(storedFiles) as PrContentFile[];
      }
    } catch {
      // Ignore errors
    }
    return [];
  });
  const [orderedFiles, setOrderedFiles] = useState<PrContentFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  // User's explicit file selection (only set when user changes selection)
  const [userSelectedFile, setUserSelectedFile] = useState<string | null>(() => {
    try {
      return localStorage.getItem(SELECTED_FILE_STORAGE_KEY);
    } catch {
      return null;
    }
  });

  // Drag and drop state for path ordering
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

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

  // Persist test mode to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(TEST_MODE_STORAGE_KEY, testMode);
    } catch {
      // Ignore localStorage errors
    }
  }, [testMode]);

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

  // Compute ordered files when files change, trying to restore order from localStorage
  // Using useMemo instead of useEffect to avoid cascading renders
  const computedOrderedFiles = useMemo(() => {
    if (files.length === 0) {
      return [];
    }

    try {
      const storedOrder = localStorage.getItem(ORDERED_FILES_STORAGE_KEY);
      const storedUrl = localStorage.getItem(FETCHED_URL_STORAGE_KEY);

      // Only restore order if it's for the same PR URL
      if (storedOrder && storedUrl === prUrl) {
        const orderedIds = JSON.parse(storedOrder) as string[];

        // Create a map of files by directory name for quick lookup
        const filesMap = new Map(files.map((f) => [f.directoryName, f]));

        // Restore order by mapping stored IDs to current files
        const restoredOrder: PrContentFile[] = [];
        const usedIds = new Set<string>();

        // First, add files in the stored order
        orderedIds.forEach((id) => {
          const file = filesMap.get(id);
          if (file) {
            restoredOrder.push(file);
            usedIds.add(id);
          }
        });

        // Then add any new files that weren't in the stored order
        files.forEach((file) => {
          if (!usedIds.has(file.directoryName)) {
            restoredOrder.push(file);
          }
        });

        return restoredOrder;
      }
    } catch {
      // Ignore errors, fall through to default
    }

    // Default: use files as-is
    return files;
  }, [files, prUrl]);

  // Sync orderedFiles with computed value, but allow manual reordering via setOrderedFiles
  useEffect(() => {
    setOrderedFiles(computedOrderedFiles);
  }, [computedOrderedFiles]);

  // Set initial fetch state based on restored files - moved to initialization
  const initialFetchState = useMemo(() => {
    if (files.length > 0) {
      return 'fetched' as FetchState;
    }
    return 'idle' as FetchState;
  }, [files.length]);

  // Apply initial fetch state once
  useEffect(() => {
    if (fetchState === 'idle' && initialFetchState === 'fetched') {
      setFetchState('fetched');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Persist fetched files to localStorage
  useEffect(() => {
    try {
      if (files.length > 0) {
        localStorage.setItem(FETCHED_FILES_STORAGE_KEY, JSON.stringify(files));
        localStorage.setItem(FETCHED_URL_STORAGE_KEY, prUrl);
      }
    } catch {
      // Ignore localStorage errors
    }
  }, [files, prUrl]);

  // Persist ordered files to localStorage
  useEffect(() => {
    try {
      if (orderedFiles.length > 0) {
        const orderIds = orderedFiles.map((f) => f.directoryName);
        localStorage.setItem(ORDERED_FILES_STORAGE_KEY, JSON.stringify(orderIds));
      }
    } catch {
      // Ignore localStorage errors
    }
  }, [orderedFiles]);

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
    return files[0]!.directoryName;
  }, [files, userSelectedFile]);

  // Build select options from files
  const fileOptions: Array<ComboboxOption<string>> = useMemo(
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
    setWarning(null);
    setFiles([]);

    const result = await fetchPrContentFilesFromUrl(cleanedUrl, abortControllerRef.current.signal);

    // Ignore aborted results - component may have unmounted or URL changed
    if (!result.success && result.error.type === 'aborted') {
      return;
    }

    if (result.success) {
      setFiles(result.files);
      setWarning(result.warning || null);
      setFetchState('fetched');
    } else {
      setError(result.error.message);
      setFetchState('error');
    }
  }, [prUrl]);

  // Create a learning path data structure from ordered files
  const createLearningPathFromFiles = useCallback(
    (files: PrContentFile[]): { url: string; title: string } => {
      const prName = prUrl.match(/\/pull\/(\d+)/)?.[1] || 'PR';
      const title = `PR ${prName} Test Path`;
      // Use stable ID based on PR number and file list to preserve completion state
      // This allows the "Reset guide" button to work and completion to persist
      const fileSignature = files.map((f) => f.directoryName).join('-');
      const pathId = `pr-test-${prName}-${fileSignature}`;

      // Create a JSON guide with section structure
      // Each guide becomes a section with an interactive step to proceed
      // Note: Don't include heading in markdown - it's rendered separately by ContentRenderer
      const jsonGuide = {
        id: pathId,
        title: title,
        blocks: [
          {
            type: 'markdown',
            content: `Testing ${files.length} guides from PR #${prName}\n\n${files.map((file, i) => `${i + 1}. ${file.directoryName}`).join('\n')}`,
          },
          {
            type: 'section',
            id: `${pathId}-intro`,
            title: 'Ready to begin?',
            blocks: [
              {
                type: 'markdown',
                content: 'Click the button below to start testing the guides in sequence.',
              },
              {
                type: 'interactive',
                action: 'noop',
                content: 'Click **Continue** to proceed to the first guide.',
                skippable: false,
              },
            ],
          },
          // Add each guide as a section with unique ID
          ...files.map((file, index) => ({
            type: 'section',
            id: `${pathId}-${file.directoryName}-${index}`,
            title: `Guide ${index + 1}: ${file.directoryName}`,
            blocks: [
              {
                type: 'markdown',
                content: `Testing guide: **${file.directoryName}**\n\nStatus: **${file.status}**\n\n[${file.directoryName}](${file.rawUrl})`,
              },
              {
                type: 'interactive',
                action: 'noop',
                content: `After testing **${file.directoryName}**, click **Continue** to ${index < files.length - 1 ? 'proceed to the next guide' : 'complete the test path'}.`,
                skippable: false,
              },
            ],
          })),
        ],
      };

      // Create a bundled URL (which is always allowed by security)
      const bundledUrl = `bundled:pr-tests/${pathId}`;

      // Store the JSON guide in sessionStorage so it can be fetched
      try {
        sessionStorage.setItem(`pathfinder-bundled-${pathId}`, JSON.stringify(jsonGuide));
      } catch (error) {
        console.error('Failed to store learning path in sessionStorage:', error);
      }

      return {
        url: bundledUrl,
        title: title,
      };
    },
    [prUrl]
  );

  // Handle test guide action
  const handleTestGuide = useCallback(() => {
    if (!currentFile) {
      return;
    }

    if (testMode === 'single') {
      // Single mode - open one guide
      onOpenDocsPage(currentFile.rawUrl, currentFile.directoryName);
      setTestSuccess(true);
    } else if (testMode === 'all') {
      // Open all guides in separate tabs
      files.forEach((file) => {
        onOpenDocsPage(file.rawUrl, file.directoryName);
      });
      setTestSuccess(true);
    } else if (testMode === 'path' && onOpenLearningJourney) {
      // Create a learning path from ordered files
      const pathData = createLearningPathFromFiles(orderedFiles);
      onOpenLearningJourney(pathData.url, pathData.title);
      setTestSuccess(true);
    }

    // REACT: track timeout for cleanup on unmount (R1)
    successTimeoutRef.current = setTimeout(() => setTestSuccess(false), 2000);
  }, [currentFile, files, orderedFiles, testMode, onOpenDocsPage, onOpenLearningJourney, createLearningPathFromFiles]);

  // Handle URL input change - reset state when URL changes from stored URL
  const handleUrlChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newUrl = e.currentTarget.value;
    setPrUrl(newUrl);
    setTestSuccess(false);

    // Only clear files if URL actually changed from the fetched URL
    try {
      const fetchedUrl = localStorage.getItem(FETCHED_URL_STORAGE_KEY);
      if (newUrl.trim() !== fetchedUrl) {
        setFetchState('idle');
        setError(null);
        setFiles([]);
        // Clear cached data
        localStorage.removeItem(FETCHED_FILES_STORAGE_KEY);
        localStorage.removeItem(FETCHED_URL_STORAGE_KEY);
        localStorage.removeItem(ORDERED_FILES_STORAGE_KEY);
      }
    } catch {
      // Fallback if localStorage fails
      setFetchState('idle');
      setError(null);
      setFiles([]);
    }
  }, []);

  // Handle file selection change
  const handleFileSelect = useCallback((option: ComboboxOption<string>) => {
    setUserSelectedFile(option.value);
  }, []);

  // Handle test mode change
  const handleTestModeChange = useCallback((value: TestMode) => {
    setTestMode(value);
  }, []);

  // Drag and drop handlers for path ordering
  const handleDragStart = useCallback((index: number) => {
    setDraggedIndex(index);
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent, index: number) => {
      e.preventDefault();
      if (draggedIndex === null || draggedIndex === index) {
        return;
      }

      const newOrderedFiles = [...orderedFiles];
      const draggedFile = newOrderedFiles[draggedIndex]!;
      newOrderedFiles.splice(draggedIndex, 1);
      newOrderedFiles.splice(index, 0, draggedFile);

      setOrderedFiles(newOrderedFiles);
      setDraggedIndex(index);
    },
    [draggedIndex, orderedFiles]
  );

  const handleDragEnd = useCallback(() => {
    setDraggedIndex(null);
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

  const modeOptions: Array<SelectableValue<TestMode>> = [
    { label: 'Single', value: 'single' as TestMode, description: 'Test one guide at a time' },
    { label: 'Open All', value: 'all' as TestMode, description: 'Open all guides in tabs' },
    ...(onOpenLearningJourney
      ? [{ label: 'Learning Path', value: 'path' as TestMode, description: 'Create sequential path' }]
      : []),
  ];

  const getActionButtonText = () => {
    if (testMode === 'single') {
      return 'Test guide';
    } else if (testMode === 'all') {
      return `Open all ${files.length} guides`;
    } else {
      return 'Test as learning path';
    }
  };

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
          {isFetching ? 'Fetching...' : hasFetched ? 'Re-fetch PR' : 'Fetch PR'}
        </Button>
      </Box>

      {/* Test Mode Selection */}
      {hasFetched && hasMultipleFiles && (
        <div className={styles.modeContainer}>
          <label className={styles.label}>Test mode</label>
          <RadioButtonGroup options={modeOptions} value={testMode} onChange={handleTestModeChange} fullWidth />
        </div>
      )}

      {/* File Selection (when multiple files and in single mode) */}
      {hasFetched && hasMultipleFiles && testMode === 'single' && (
        <div className={styles.selectContainer}>
          <label className={styles.label}>Guide to test</label>
          <Combobox options={fileOptions} value={selectedFile} onChange={handleFileSelect} />
        </div>
      )}

      {/* Path Ordering Interface (when in path mode) */}
      {hasFetched && testMode === 'path' && (
        <div className={styles.pathOrderContainer}>
          <label className={styles.label}>
            <Icon name="draggabledots" /> Drag to reorder guides
          </label>
          <div className={styles.fileList}>
            {orderedFiles.map((file, index) => (
              <div
                key={file.directoryName}
                className={`${styles.fileItem} ${draggedIndex === index ? styles.fileItemDragging : ''}`}
                draggable // eslint-disable-line no-restricted-syntax -- Dev-only PR tester, native DnD acceptable here
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
              >
                <div className={styles.fileItemNumber}>{index + 1}</div>
                <div className={styles.fileItemContent}>
                  <Icon name="draggabledots" className={styles.dragHandle} />
                  <span className={styles.fileName}>{file.directoryName}</span>
                  <span className={getStatusClass(file.status)}>{file.status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All Guides Preview (when in all mode) */}
      {hasFetched && testMode === 'all' && (
        <div className={styles.allGuidesPreview}>
          <label className={styles.label}>Will open {files.length} guides:</label>
          <ul className={styles.guidesList}>
            {files.map((file) => (
              <li key={file.directoryName} className={styles.guidesListItem}>
                <Icon name="document-info" />
                <span>{file.directoryName}</span>
                <span className={getStatusClass(file.status)}>{file.status}</span>
              </li>
            ))}
          </ul>
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
          <Button
            variant="secondary"
            size="sm"
            onClick={handleTestGuide}
            disabled={testMode === 'single' ? !currentFile : files.length === 0}
          >
            {getActionButtonText()}
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

      {/* Warning Message */}
      {warning && (
        <div className={`${styles.resultBox} ${styles.resultWarning}`}>
          <p className={styles.resultText}>
            <Icon name="info-circle" /> {warning}
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
