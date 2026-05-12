import React, { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import { Box, Button, Icon, Input, Combobox, useStyles2, RadioButtonGroup, type ComboboxOption } from '@grafana/ui';
import { SelectableValue } from '@grafana/data';
import { getPrTesterStyles } from './pr-tester.styles';
import { fetchPrContentFilesFromUrl, fetchPrManifest, isValidPrUrl, type PrJsonFile } from './github-api';
import {
  buildPathPackageInfo,
  indexContentByPackageId,
  indexPrFiles,
  type PathPackageBuildResult,
} from './pr-path-package';
import type { ManifestJson } from '../../types/package.types';
import type { PackageOpenInfo } from '../../types/content-panel.types';
import { testIds } from '../../constants/testIds';

const PR_URL_STORAGE_KEY = 'pathfinder-pr-tester-url';
const SELECTED_FILE_STORAGE_KEY = 'pathfinder-pr-tester-selected';
const SELECTED_PATH_STORAGE_KEY = 'pathfinder-pr-tester-selected-path';
const TEST_MODE_STORAGE_KEY = 'pathfinder-pr-tester-mode';
const FETCHED_FILES_STORAGE_KEY = 'pathfinder-pr-tester-files';
const FETCHED_URL_STORAGE_KEY = 'pathfinder-pr-tester-fetched-url';

export interface PrTesterProps {
  /**
   * Open a docs page (or package). When `packageInfo` is supplied the docs
   * panel will route through `fetchPackageContent` and render the real
   * milestone toolbar / Alt+arrow navigation, exactly like the recommender's
   * path packages.
   */
  onOpenDocsPage: (url: string, title: string, packageInfo?: PackageOpenInfo) => void;
}

type FetchState = 'idle' | 'fetching' | 'fetched' | 'error';
type TestMode = 'single' | 'all' | 'path';

/**
 * PR Tester — load JSON files from a GitHub PR and test them locally.
 *
 * Modes:
 * 1. Single — open one content.json
 * 2. Open all — open every content.json in separate tabs
 * 3. Learning path — detect a `path`/`journey` manifest in the PR and open
 *    it as a real package (cover page + milestone toolbar + Alt+arrow nav)
 *    using the same pipeline the recommender uses for production paths.
 */
export function PrTester({ onOpenDocsPage }: PrTesterProps) {
  const styles = useStyles2(getPrTesterStyles);

  const [prUrl, setPrUrl] = useState(() => {
    try {
      return localStorage.getItem(PR_URL_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });

  const [testMode, setTestMode] = useState<TestMode>(() => {
    try {
      return (localStorage.getItem(TEST_MODE_STORAGE_KEY) as TestMode) || 'single';
    } catch {
      return 'single';
    }
  });

  const [fetchState, setFetchState] = useState<FetchState>('idle');
  const [files, setFiles] = useState<PrJsonFile[]>(() => {
    try {
      const storedFiles = localStorage.getItem(FETCHED_FILES_STORAGE_KEY);
      const storedUrl = localStorage.getItem(FETCHED_URL_STORAGE_KEY);
      const currentUrl = localStorage.getItem(PR_URL_STORAGE_KEY);
      if (storedFiles && storedUrl === currentUrl) {
        return JSON.parse(storedFiles) as PrJsonFile[];
      }
    } catch {
      // Ignore
    }
    return [];
  });

  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  /** User's explicit content-file selection for single mode (only set when changed). */
  const [userSelectedFile, setUserSelectedFile] = useState<string | null>(() => {
    try {
      return localStorage.getItem(SELECTED_FILE_STORAGE_KEY);
    } catch {
      return null;
    }
  });

  /** User's explicit path-package selection (only set when changed). */
  const [userSelectedPath, setUserSelectedPath] = useState<string | null>(() => {
    try {
      return localStorage.getItem(SELECTED_PATH_STORAGE_KEY);
    } catch {
      return null;
    }
  });

  /**
   * All parsed manifests in the PR, indexed by directoryName.
   *
   * We keep every manifest (not just path/journey) because child packages of
   * a path use their *own* `manifest.id` as the canonical key. Without those
   * we can't translate `manifest.milestones` (package IDs) into raw URLs in
   * the PR — directory names are storage, package IDs are identity.
   */
  const [allManifests, setAllManifests] = useState<Map<string, ManifestJson>>(new Map());
  const [manifestsLoading, setManifestsLoading] = useState(false);

  const [testSuccess, setTestSuccess] = useState(false);

  // REACT: refs for cleanup on unmount (R1, R4)
  const abortControllerRef = useRef<AbortController>();
  const manifestAbortRef = useRef<AbortController>();
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      manifestAbortRef.current?.abort();
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(PR_URL_STORAGE_KEY, prUrl);
    } catch {
      // Ignore localStorage errors
    }
  }, [prUrl]);

  useEffect(() => {
    try {
      localStorage.setItem(TEST_MODE_STORAGE_KEY, testMode);
    } catch {
      // Ignore localStorage errors
    }
  }, [testMode]);

  useEffect(() => {
    try {
      if (userSelectedFile) {
        localStorage.setItem(SELECTED_FILE_STORAGE_KEY, userSelectedFile);
      }
    } catch {
      // Ignore localStorage errors
    }
  }, [userSelectedFile]);

  useEffect(() => {
    try {
      if (userSelectedPath) {
        localStorage.setItem(SELECTED_PATH_STORAGE_KEY, userSelectedPath);
      }
    } catch {
      // Ignore localStorage errors
    }
  }, [userSelectedPath]);

  // Set initial fetch state based on restored files
  const initialFetchState = useMemo(() => (files.length > 0 ? 'fetched' : 'idle') as FetchState, [files.length]);

  useEffect(() => {
    if (fetchState === 'idle' && initialFetchState === 'fetched') {
      setFetchState('fetched');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

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

  // Content-only subset for single/all modes
  const contentFiles = useMemo(() => files.filter((f) => f.kind === 'content'), [files]);
  const manifestFiles = useMemo(() => files.filter((f) => f.kind === 'manifest'), [files]);

  /**
   * Stable signature for the manifest set. The preload effect below depends
   * on this string instead of the `manifestFiles` array reference so we don't
   * abort + restart in-flight fetches every time `files` changes — even when
   * the manifest subset is identical (e.g. a content-only update). The rawUrl
   * encodes both the file path AND the head SHA, so a force-push or directory
   * rename produces a different fingerprint and correctly triggers a refetch.
   */
  const manifestFingerprint = useMemo(
    () =>
      manifestFiles
        .map((f) => f.rawUrl)
        .sort()
        .join('|'),
    [manifestFiles]
  );

  /**
   * Latest manifestFiles, read inside the preload effect via ref so the
   * effect can depend on the stable fingerprint while still using the
   * up-to-date file list when it does run.
   */
  const manifestFilesRef = useRef(manifestFiles);
  manifestFilesRef.current = manifestFiles;

  /**
   * Load every manifest.json in the PR in parallel.
   *
   * We keep them all (not just path/journey) so we can resolve milestone
   * package IDs to raw URLs via each child manifest's `id` field, even when
   * the directory name and the canonical package ID disagree.
   */
  useEffect(() => {
    const currentManifestFiles = manifestFilesRef.current;
    if (currentManifestFiles.length === 0) {
      setAllManifests(new Map());
      setManifestsLoading(false);
      return;
    }

    manifestAbortRef.current?.abort();
    const controller = new AbortController();
    manifestAbortRef.current = controller;

    setManifestsLoading(true);
    let cancelled = false;

    (async () => {
      try {
        const results = await Promise.all(
          currentManifestFiles.map(async (file) => {
            const manifest = await fetchPrManifest(file.rawUrl, controller.signal);
            return { file, manifest };
          })
        );
        if (cancelled || controller.signal.aborted) {
          return;
        }
        const next = new Map<string, ManifestJson>();
        for (const { file, manifest } of results) {
          if (manifest) {
            next.set(file.directoryName, manifest);
          }
        }
        setAllManifests(next);
      } catch (error) {
        // `fetchPrManifest` already swallows its own errors, but anything
        // else inside this block (Promise.all rejection from an unexpected
        // throw, a post-unmount setState, etc.) must still flip us out of
        // the loading state. Without this `finally`, the path-mode UI
        // would be stuck on "Loading manifests..." with no recovery path.
        if (!cancelled && !controller.signal.aborted) {
          console.error('[PrTester] manifest preload failed', error);
          setAllManifests(new Map());
        }
      } finally {
        if (!cancelled && !controller.signal.aborted) {
          setManifestsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [manifestFingerprint]);

  /** Subset that drives the path-mode UI: only path/journey manifests. */
  const pathManifests = useMemo(() => {
    const next = new Map<string, ManifestJson>();
    for (const [dir, manifest] of allManifests) {
      if (manifest.type === 'path' || manifest.type === 'journey') {
        next.set(dir, manifest);
      }
    }
    return next;
  }, [allManifests]);

  /**
   * Index PR files by directory once and share the result with everything
   * downstream (`indexContentByPackageId` for milestone resolution and
   * `buildPathPackageInfo` for the cover-page lookup). Without this each
   * call site would re-iterate `files`, doubling work on every render that
   * touches the PR.
   */
  const contentByDir = useMemo(() => indexPrFiles(files).contentByDir, [files]);

  /**
   * `manifest.milestones[]` lists package IDs, not directory names.
   * Build the ID→file index by reading each child's manifest.id so the path
   * tester resolves milestones the same way the production resolver does.
   */
  const contentByPackageId = useMemo(
    () => indexContentByPackageId(contentByDir, allManifests),
    [contentByDir, allManifests]
  );

  // Effective selected single-mode file
  const selectedFile = useMemo(() => {
    if (contentFiles.length === 0) {
      return null;
    }
    if (userSelectedFile && contentFiles.some((f) => f.directoryName === userSelectedFile)) {
      return userSelectedFile;
    }
    return contentFiles[0]!.directoryName;
  }, [contentFiles, userSelectedFile]);

  const fileOptions: Array<ComboboxOption<string>> = useMemo(
    () =>
      contentFiles.map((file) => ({
        value: file.directoryName,
        label: file.directoryName,
        description: file.status,
      })),
    [contentFiles]
  );

  const currentFile = useMemo(
    () => contentFiles.find((f) => f.directoryName === selectedFile),
    [contentFiles, selectedFile]
  );

  const pathManifestEntries = useMemo(() => Array.from(pathManifests.entries()), [pathManifests]);

  // Effective selected path manifest
  const selectedPath = useMemo(() => {
    if (pathManifestEntries.length === 0) {
      return null;
    }
    if (userSelectedPath && pathManifests.has(userSelectedPath)) {
      return userSelectedPath;
    }
    return pathManifestEntries[0]![0];
  }, [pathManifestEntries, pathManifests, userSelectedPath]);

  const pathOptions: Array<ComboboxOption<string>> = useMemo(
    () =>
      pathManifestEntries.map(([dir, manifest]) => ({
        value: dir,
        label: manifest.id,
        description: manifest.type,
      })),
    [pathManifestEntries]
  );

  /**
   * Build the path package preview for the currently selected manifest. Pure
   * derivation from the shared `contentByDir` index + `pathManifests` — no
   * side effects, so we memo it and use the same value for both the preview
   * list and the action.
   */
  const pathBuild: PathPackageBuildResult | null = useMemo(() => {
    if (!selectedPath) {
      return null;
    }
    const manifest = pathManifests.get(selectedPath);
    if (!manifest) {
      return null;
    }
    return buildPathPackageInfo({
      contentByDir,
      manifest,
      manifestDirectory: selectedPath,
      contentByPackageId,
    });
  }, [contentByDir, pathManifests, selectedPath, contentByPackageId]);

  const handleFetchPr = useCallback(async () => {
    const cleanedUrl = prUrl.trim();

    if (!isValidPrUrl(cleanedUrl)) {
      setError('Invalid PR URL. Expected format: github.com/owner/repo/pull/123');
      setFetchState('error');
      return;
    }

    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();

    setFetchState('fetching');
    setError(null);
    setWarning(null);
    setFiles([]);
    setAllManifests(new Map());

    const result = await fetchPrContentFilesFromUrl(cleanedUrl, abortControllerRef.current.signal);

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

  const handleTestGuide = useCallback(() => {
    if (testMode === 'single') {
      if (!currentFile) {
        return;
      }
      onOpenDocsPage(currentFile.rawUrl, currentFile.directoryName);
      setTestSuccess(true);
    } else if (testMode === 'all') {
      contentFiles.forEach((file) => {
        onOpenDocsPage(file.rawUrl, file.directoryName);
      });
      setTestSuccess(true);
    } else if (testMode === 'path') {
      if (!pathBuild || !pathBuild.ok) {
        return;
      }
      onOpenDocsPage(pathBuild.coverUrl, pathBuild.title, pathBuild.packageInfo);
      setTestSuccess(true);
    }

    successTimeoutRef.current = setTimeout(() => setTestSuccess(false), 2000);
  }, [contentFiles, currentFile, onOpenDocsPage, pathBuild, testMode]);

  const handleUrlChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newUrl = e.currentTarget.value;
    setPrUrl(newUrl);
    setTestSuccess(false);

    try {
      const fetchedUrl = localStorage.getItem(FETCHED_URL_STORAGE_KEY);
      if (newUrl.trim() !== fetchedUrl) {
        setFetchState('idle');
        setError(null);
        setFiles([]);
        setAllManifests(new Map());
        localStorage.removeItem(FETCHED_FILES_STORAGE_KEY);
        localStorage.removeItem(FETCHED_URL_STORAGE_KEY);
      }
    } catch {
      setFetchState('idle');
      setError(null);
      setFiles([]);
      setAllManifests(new Map());
    }
  }, []);

  const handleFileSelect = useCallback((option: ComboboxOption<string>) => {
    setUserSelectedFile(option.value);
  }, []);

  const handlePathSelect = useCallback((option: ComboboxOption<string>) => {
    setUserSelectedPath(option.value);
  }, []);

  const handleTestModeChange = useCallback((value: TestMode) => {
    setTestMode(value);
  }, []);

  const getStatusClass = (status: PrJsonFile['status']) => {
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
  const hasMultipleContentFiles = contentFiles.length > 1;
  const hasSingleContentFile = contentFiles.length === 1;
  const hasAnyPathPackage = pathManifestEntries.length > 0;

  // Path mode is only meaningful when at least one path/journey manifest is in the PR.
  const modeOptions: Array<SelectableValue<TestMode>> = [
    { label: 'Single', value: 'single' as TestMode, description: 'Test one guide at a time' },
    { label: 'Open all', value: 'all' as TestMode, description: 'Open all guides in tabs' },
    {
      label: 'Learning path',
      value: 'path' as TestMode,
      description: hasAnyPathPackage
        ? 'Test a path/journey package as a real journey'
        : 'No path/journey manifest found in this PR',
    },
  ];

  const getActionButtonText = () => {
    if (testMode === 'single') {
      return 'Test guide';
    } else if (testMode === 'all') {
      return `Open all ${contentFiles.length} guides`;
    } else {
      return 'Test as learning path';
    }
  };

  const isActionDisabled = (() => {
    if (testMode === 'single') {
      return !currentFile;
    }
    if (testMode === 'all') {
      return contentFiles.length === 0;
    }
    return !pathBuild || !pathBuild.ok;
  })();

  /**
   * Human-readable explanation when the path build is not OK. Surfaces in a
   * warning box so the author knows why "Test as learning path" is disabled.
   */
  const pathErrorMessage = useMemo(() => {
    if (!hasFetched || testMode !== 'path') {
      return null;
    }
    if (manifestsLoading) {
      return null;
    }
    if (!hasAnyPathPackage) {
      return 'No path or journey manifest found in this PR. Add a manifest.json with type "path" or "journey" to test as a learning path.';
    }
    if (!pathBuild) {
      return null;
    }
    if (pathBuild.ok) {
      return null;
    }
    if (pathBuild.reason === 'no_milestones') {
      return 'The selected manifest has no milestones to chain together.';
    }
    if (pathBuild.reason === 'missing_cover') {
      return 'The selected manifest has no sibling content.json in the PR. Add the cover page to test it as a learning path.';
    }
    if (pathBuild.reason === 'missing_milestones' && pathBuild.missingMilestones?.length) {
      return `Missing milestone content in this PR: ${pathBuild.missingMilestones.join(', ')}. Include each milestone's content.json in the PR.`;
    }
    return null;
  }, [hasFetched, testMode, manifestsLoading, hasAnyPathPackage, pathBuild]);

  return (
    <div className={styles.formGroup} data-testid={testIds.prTester.form}>
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
        data-testid={testIds.prTester.prNumberInput}
      />
      <p className={styles.helpText}>
        Paste a GitHub pull request URL. We look for content.json and manifest.json files.
      </p>

      <Box marginTop={1}>
        <Button
          variant="primary"
          size="sm"
          onClick={handleFetchPr}
          disabled={!prUrl.trim() || isFetching}
          icon={isFetching ? 'fa fa-spinner' : undefined}
          data-testid={testIds.prTester.loadButton}
        >
          {isFetching ? 'Fetching...' : hasFetched ? 'Re-fetch PR' : 'Fetch PR'}
        </Button>
      </Box>

      {hasFetched && (hasMultipleContentFiles || hasAnyPathPackage) && (
        <div className={styles.modeContainer}>
          <label className={styles.label}>Test mode</label>
          <RadioButtonGroup options={modeOptions} value={testMode} onChange={handleTestModeChange} fullWidth />
        </div>
      )}

      {hasFetched && hasMultipleContentFiles && testMode === 'single' && (
        <div className={styles.selectContainer}>
          <label className={styles.label}>Guide to test</label>
          <Combobox
            options={fileOptions}
            value={selectedFile}
            onChange={handleFileSelect}
            data-testid={testIds.prTester.fileSelect}
          />
        </div>
      )}

      {/* Path mode: pick a manifest + show its milestones in manifest order */}
      {hasFetched && testMode === 'path' && (
        <div className={styles.pathOrderContainer}>
          {manifestsLoading && (
            <p className={styles.helpText}>
              <Icon name="fa fa-spinner" /> Loading manifests...
            </p>
          )}
          {!manifestsLoading && hasAnyPathPackage && pathManifestEntries.length > 1 && (
            <div className={styles.selectContainer}>
              <label className={styles.label}>Path package to test</label>
              <Combobox options={pathOptions} value={selectedPath} onChange={handlePathSelect} />
            </div>
          )}
          {/* Only render the milestones list when we actually have items to
              show: a successful build, OR a `missing_milestones` failure
              where each manifest milestone ID is rendered with its missing
              badge. The other failure reasons (`no_milestones`,
              `missing_cover`, `not_path_package`) are surfaced via
              `pathErrorMessage` below — without this gate they leave the
              "Milestones (from manifest)" label hovering above an empty
              <ol>. */}
          {!manifestsLoading && pathBuild?.ok && (
            <>
              <label className={styles.label}>Milestones (from manifest)</label>
              <ol className={styles.guidesList}>
                {pathBuild.packageInfo.resolvedMilestones?.map((milestone) => (
                  <li key={milestone.title} className={styles.guidesListItem}>
                    <Icon name="document-info" />
                    <span>{milestone.title}</span>
                  </li>
                ))}
              </ol>
            </>
          )}
          {!manifestsLoading && pathBuild && !pathBuild.ok && pathBuild.reason === 'missing_milestones' && (
            <>
              <label className={styles.label}>Milestones (from manifest)</label>
              <ol className={styles.guidesList}>
                {pathManifests.get(selectedPath ?? '')?.milestones?.map((id) => {
                  const isMissing = pathBuild.missingMilestones?.includes(id);
                  return (
                    <li key={id} className={styles.guidesListItem}>
                      <Icon name={isMissing ? 'exclamation-triangle' : 'document-info'} />
                      <span>{id}</span>
                      {isMissing && <span className={getStatusClass('removed')}>not in PR</span>}
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </div>
      )}

      {hasFetched && testMode === 'all' && (
        <div className={styles.allGuidesPreview}>
          <label className={styles.label}>Will open {contentFiles.length} guides:</label>
          <ul className={styles.guidesList}>
            {contentFiles.map((file) => (
              <li key={file.directoryName} className={styles.guidesListItem}>
                <Icon name="document-info" />
                <span>{file.directoryName}</span>
                <span className={getStatusClass(file.status)}>{file.status}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasFetched && hasSingleContentFile && testMode === 'single' && currentFile && (
        <div className={styles.readyText}>
          <Icon name="check" />
          Ready: {currentFile.directoryName}
          <span className={getStatusClass(currentFile.status)}>{currentFile.status}</span>
        </div>
      )}

      {hasFetched && (
        <Box marginTop={1}>
          <Button variant="secondary" size="sm" onClick={handleTestGuide} disabled={isActionDisabled}>
            {getActionButtonText()}
          </Button>
        </Box>
      )}

      {error && (
        <div className={`${styles.resultBox} ${styles.resultError}`}>
          <p className={styles.resultText}>
            <Icon name="exclamation-triangle" /> {error}
          </p>
        </div>
      )}

      {warning && (
        <div className={`${styles.resultBox} ${styles.resultWarning}`}>
          <p className={styles.resultText}>
            <Icon name="info-circle" /> {warning}
          </p>
        </div>
      )}

      {pathErrorMessage && (
        <div className={`${styles.resultBox} ${styles.resultWarning}`}>
          <p className={styles.resultText}>
            <Icon name="info-circle" /> {pathErrorMessage}
          </p>
        </div>
      )}

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
