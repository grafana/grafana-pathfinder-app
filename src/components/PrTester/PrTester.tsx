import React, { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import { Box, Button, Icon, Input, Combobox, useStyles2, RadioButtonGroup, type ComboboxOption } from '@grafana/ui';
import { SelectableValue } from '@grafana/data';
import { getPrTesterStyles } from './pr-tester.styles';
import {
  fetchPrContentFilesFromUrl,
  fetchPrContentMeta,
  fetchPrManifest,
  isValidPrUrl,
  type PrJsonFile,
} from './github-api';
import {
  buildPathPackageInfo,
  discoverCatalogPaths,
  getCatalogMilestoneIds,
  type PathPackageBuildResult,
  type PrContentEntry,
} from './pr-path-package';
import { resolveEffectiveTestMode, type TestMode } from './pr-tester-mode';
import { fetchOnlinePackageRecommendations, type OnlinePackageEntry } from '../../lib/package-recommendations-client';
import type { ManifestJson } from '../../types/package.types';
import type { PackageOpenInfo } from '../../types/content-panel.types';
import { testIds } from '../../constants/testIds';
import { StorageKeys } from '../../lib/storage-keys';
import { logger } from '../../lib/logging';

const PR_URL_STORAGE_KEY = StorageKeys.DEVTOOLS_PR_TESTER_URL;
const SELECTED_FILE_STORAGE_KEY = StorageKeys.DEVTOOLS_PR_TESTER_SELECTED_FILE;
const SELECTED_PATH_STORAGE_KEY = StorageKeys.DEVTOOLS_PR_TESTER_SELECTED_PATH;
const TEST_MODE_STORAGE_KEY = StorageKeys.DEVTOOLS_PR_TESTER_MODE;
const FETCHED_FILES_STORAGE_KEY = StorageKeys.DEVTOOLS_PR_TESTER_FETCHED_FILES;
const FETCHED_URL_STORAGE_KEY = StorageKeys.DEVTOOLS_PR_TESTER_FETCHED_URL;

const EMPTY_CATALOG_BY_ID: ReadonlyMap<string, OnlinePackageEntry> = new Map();

/** The published catalog, indexed for reverse lookup + URL building. */
interface CatalogState {
  baseUrl: string;
  entries: OnlinePackageEntry[];
  byId: Map<string, OnlinePackageEntry>;
}

/** A path/journey testable in path mode — either from the PR or auto-discovered from the catalog. */
interface PathCandidate {
  /** Selector value: PR directory name, or `cdn:<id>` for a catalog-discovered path. */
  key: string;
  id: string;
  origin: 'pr' | 'cdn';
  label: string;
  type: string;
  milestoneIds: string[];
  description?: string;
  manifest?: Record<string, unknown>;
}

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

/**
 * PR Tester — load JSON files from a GitHub PR and test them locally.
 *
 * Modes:
 * 1. Single — open one content.json
 * 2. Open all — open every content.json in separate tabs
 * 3. Learning path — open a `path`/`journey` as a real package. Milestones the
 *    PR changes are served from the PR; unchanged milestones (and paths whose
 *    manifest isn't in the PR) are resolved from the published CDN catalog.
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

  // Initial fetch state reflects whether files were restored from storage.
  const [fetchState, setFetchState] = useState<FetchState>(() => (files.length > 0 ? 'fetched' : 'idle'));

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

  /** All parsed manifests in the PR, indexed by directoryName — used to detect path/journey packages. */
  const [allManifests, setAllManifests] = useState<Map<string, ManifestJson>>(new Map());

  /**
   * PR content.json files keyed by their own package `id`. The content's `id`
   * is the canonical milestone ID, so this maps a changed milestone to a path's
   * `manifest.milestones[]` even when its sibling manifest.json isn't in the diff.
   */
  const [prContentById, setPrContentById] = useState<Map<string, PrContentEntry>>(new Map());
  const [metaLoading, setMetaLoading] = useState(false);

  /** Published package catalog, used to discover paths and resolve unchanged milestones. */
  const [catalog, setCatalog] = useState<CatalogState | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);

  const [testSuccess, setTestSuccess] = useState(false);

  // REACT: refs for cleanup on unmount (R1, R4)
  const abortControllerRef = useRef<AbortController>();
  const metaAbortRef = useRef<AbortController>();
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      metaAbortRef.current?.abort();
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

  /**
   * Stable signature for the file set. The preload effects below depend on this
   * string instead of the `files` array reference so we don't abort + restart
   * in-flight fetches on every render. Each rawUrl encodes both the file path
   * AND the head SHA, so a force-push or rename produces a different fingerprint
   * and correctly triggers a refetch.
   */
  const filesFingerprint = useMemo(
    () =>
      files
        .map((f) => f.rawUrl)
        .sort()
        .join('|'),
    [files]
  );

  const filesRef = useRef(files);
  // eslint-disable-next-line react-hooks/refs -- intentional latest-value ref read inside the preload effects (see fingerprint comment above)
  filesRef.current = files;

  /**
   * Preload every manifest.json (to detect path/journey packages) and every
   * content.json's metadata (to map changed milestones by their package id).
   */
  useEffect(() => {
    const currentFiles = filesRef.current;
    if (currentFiles.length === 0) {
      setAllManifests(new Map());
      setPrContentById(new Map());
      setMetaLoading(false);
      return;
    }

    metaAbortRef.current?.abort();
    const controller = new AbortController();
    metaAbortRef.current = controller;

    setMetaLoading(true);
    let cancelled = false;

    (async () => {
      try {
        const manifestFiles = currentFiles.filter((f) => f.kind === 'manifest');
        const contentFilesNow = currentFiles.filter((f) => f.kind === 'content');
        const [manifestResults, contentResults] = await Promise.all([
          Promise.all(
            manifestFiles.map(async (file) => ({
              file,
              manifest: await fetchPrManifest(file.rawUrl, controller.signal),
            }))
          ),
          Promise.all(
            contentFilesNow.map(async (file) => ({
              file,
              meta: await fetchPrContentMeta(file.rawUrl, controller.signal),
            }))
          ),
        ]);
        if (cancelled || controller.signal.aborted) {
          return;
        }
        const nextManifests = new Map<string, ManifestJson>();
        for (const { file, manifest } of manifestResults) {
          if (manifest) {
            nextManifests.set(file.directoryName, manifest);
          }
        }
        const nextContent = new Map<string, PrContentEntry>();
        for (const { file, meta } of contentResults) {
          if (meta) {
            nextContent.set(meta.id, { file, title: meta.title });
          }
        }
        setAllManifests(nextManifests);
        setPrContentById(nextContent);
      } catch (error) {
        // The fetch helpers swallow their own errors, but anything else inside
        // this block must still flip us out of the loading state or path mode
        // is stranded on "Loading…" with no recovery.
        if (!cancelled && !controller.signal.aborted) {
          logger.error('[PrTester] PR metadata preload failed', { error });
          setAllManifests(new Map());
          setPrContentById(new Map());
        }
      } finally {
        if (!cancelled && !controller.signal.aborted) {
          setMetaLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [filesFingerprint]);

  /**
   * Load the published package catalog once a PR is fetched. The client is
   * session-cached and never throws; an empty result degrades path mode to
   * diff-only (no auto-discovery, no CDN fallback for unchanged milestones).
   */
  useEffect(() => {
    if (filesRef.current.length === 0) {
      setCatalog(null);
      setCatalogLoading(false);
      return;
    }

    setCatalogLoading(true);
    let cancelled = false;

    (async () => {
      try {
        const response = await fetchOnlinePackageRecommendations();
        if (cancelled) {
          return;
        }
        if (!response.baseUrl || response.packages.length === 0) {
          setCatalog(null);
          return;
        }
        const byId = new Map<string, OnlinePackageEntry>();
        for (const entry of response.packages) {
          byId.set(entry.id, entry);
        }
        setCatalog({ baseUrl: response.baseUrl, entries: response.packages, byId });
      } catch {
        if (!cancelled) {
          setCatalog(null);
        }
      } finally {
        if (!cancelled) {
          setCatalogLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [filesFingerprint]);

  const pathDiscoveryLoading = metaLoading || catalogLoading;

  /** IDs of the content.json files changed in this PR. */
  const changedIds = useMemo(() => new Set(prContentById.keys()), [prContentById]);

  /** Path/journey manifests found directly in the PR diff. */
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
   * Paths testable in path mode: those whose manifest is in the PR, plus
   * published paths that contain a changed milestone (auto-discovery). PR
   * manifests win when both describe the same path id.
   */
  const pathCandidates = useMemo<PathCandidate[]>(() => {
    const prCandidates: PathCandidate[] = [];
    for (const [dir, manifest] of pathManifests) {
      prCandidates.push({
        key: dir,
        id: manifest.id,
        origin: 'pr',
        label: manifest.id,
        type: manifest.type,
        milestoneIds: Array.isArray(manifest.milestones) ? manifest.milestones : [],
        description: typeof manifest.description === 'string' ? manifest.description : undefined,
        manifest: manifest as unknown as Record<string, unknown>,
      });
    }

    const prIds = new Set(prCandidates.map((c) => c.id));
    const cdnCandidates: PathCandidate[] = [];
    if (catalog) {
      for (const entry of discoverCatalogPaths(catalog.entries, changedIds)) {
        if (prIds.has(entry.id)) {
          continue;
        }
        const manifestType = typeof entry.manifest?.type === 'string' ? (entry.manifest.type as string) : undefined;
        const manifestDescription =
          typeof entry.manifest?.description === 'string' ? (entry.manifest.description as string) : undefined;
        cdnCandidates.push({
          key: `cdn:${entry.id}`,
          id: entry.id,
          origin: 'cdn',
          label: entry.id,
          type: entry.type ?? manifestType ?? 'path',
          milestoneIds: getCatalogMilestoneIds(entry),
          description: entry.description ?? manifestDescription,
          manifest: entry.manifest,
        });
      }
    }

    return [...prCandidates, ...cdnCandidates];
  }, [pathManifests, catalog, changedIds]);

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

  // Effective selected path candidate
  const selectedPath = useMemo(() => {
    if (pathCandidates.length === 0) {
      return null;
    }
    if (userSelectedPath && pathCandidates.some((c) => c.key === userSelectedPath)) {
      return userSelectedPath;
    }
    return pathCandidates[0]!.key;
  }, [pathCandidates, userSelectedPath]);

  const selectedCandidate = useMemo(
    () => pathCandidates.find((c) => c.key === selectedPath) ?? null,
    [pathCandidates, selectedPath]
  );

  const pathOptions: Array<ComboboxOption<string>> = useMemo(
    () =>
      pathCandidates.map((c) => ({
        value: c.key,
        label: c.label,
        description: c.origin === 'pr' ? c.type : `${c.type} · from published catalog`,
      })),
    [pathCandidates]
  );

  /**
   * Build the path package preview for the selected candidate by overlaying the
   * PR's changed content on the published catalog. Pure derivation from fetched
   * state, so we memo it and reuse the same value for preview + action.
   */
  const pathBuild: PathPackageBuildResult | null = useMemo(() => {
    if (!selectedCandidate) {
      return null;
    }
    return buildPathPackageInfo({
      pathId: selectedCandidate.id,
      description: selectedCandidate.description,
      milestoneIds: selectedCandidate.milestoneIds,
      coverFromPr: prContentById.get(selectedCandidate.id)?.file,
      packageManifest: selectedCandidate.manifest,
      prContentById,
      catalogById: catalog?.byId ?? EMPTY_CATALOG_BY_ID,
      catalogBaseUrl: catalog?.baseUrl ?? '',
    });
  }, [selectedCandidate, prContentById, catalog]);

  const hasAnyPathPackage = pathCandidates.length > 0;

  // testMode is restored from localStorage and can outlive the PR it was
  // chosen for. A single-guide PR hides the mode selector, so a stale 'path'
  // would strand the panel with no way back to 'single'.
  const effectiveTestMode: TestMode = useMemo(
    () =>
      resolveEffectiveTestMode(testMode, {
        manifestsLoading: pathDiscoveryLoading,
        hasAnyPathPackage,
      }),
    [pathDiscoveryLoading, testMode, hasAnyPathPackage]
  );

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
    setPrContentById(new Map());
    setCatalog(null);

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
    if (effectiveTestMode === 'single') {
      if (!currentFile) {
        return;
      }
      onOpenDocsPage(currentFile.rawUrl, currentFile.directoryName);
      setTestSuccess(true);
    } else if (effectiveTestMode === 'all') {
      contentFiles.forEach((file) => {
        onOpenDocsPage(file.rawUrl, file.directoryName);
      });
      setTestSuccess(true);
    } else if (effectiveTestMode === 'path') {
      if (!pathBuild || !pathBuild.ok) {
        return;
      }
      onOpenDocsPage(pathBuild.coverUrl, pathBuild.title, pathBuild.packageInfo);
      setTestSuccess(true);
    }

    successTimeoutRef.current = setTimeout(() => setTestSuccess(false), 2000);
  }, [contentFiles, currentFile, onOpenDocsPage, pathBuild, effectiveTestMode]);

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
        setPrContentById(new Map());
        setCatalog(null);
        localStorage.removeItem(FETCHED_FILES_STORAGE_KEY);
        localStorage.removeItem(FETCHED_URL_STORAGE_KEY);
      }
    } catch {
      setFetchState('idle');
      setError(null);
      setFiles([]);
      setAllManifests(new Map());
      setPrContentById(new Map());
      setCatalog(null);
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

  // Path mode is only meaningful when at least one path/journey is testable.
  const modeOptions: Array<SelectableValue<TestMode>> = [
    { label: 'Single', value: 'single' as TestMode, description: 'Test one guide at a time' },
    { label: 'Open all', value: 'all' as TestMode, description: 'Open all guides in tabs' },
    {
      label: 'Learning path',
      value: 'path' as TestMode,
      description: hasAnyPathPackage
        ? 'Test a path/journey package as a real journey'
        : 'No path/journey found for this PR',
    },
  ];

  const getActionButtonText = () => {
    if (effectiveTestMode === 'single') {
      return 'Test guide';
    } else if (effectiveTestMode === 'all') {
      return `Open all ${contentFiles.length} guides`;
    } else {
      return 'Test as learning path';
    }
  };

  const isActionDisabled = (() => {
    if (effectiveTestMode === 'single') {
      return !currentFile;
    }
    if (effectiveTestMode === 'all') {
      return contentFiles.length === 0;
    }
    return !pathBuild || !pathBuild.ok;
  })();

  /** True when the assembled path pulls any milestone from the published catalog. */
  const usesPublishedContent = pathBuild?.ok ? pathBuild.preview.some((m) => m.source === 'cdn') : false;

  /**
   * Human-readable explanation when the path build is not OK. Surfaces in a
   * warning box so the author knows why "Test as learning path" is disabled.
   */
  const pathErrorMessage = useMemo(() => {
    if (!hasFetched || effectiveTestMode !== 'path' || pathDiscoveryLoading) {
      return null;
    }
    if (!hasAnyPathPackage) {
      return 'No path or journey manifest is in this PR, and no published path contains the changed guides. Add a path/journey manifest.json, or check that the path is published.';
    }
    if (!pathBuild || pathBuild.ok) {
      return null;
    }
    if (pathBuild.reason === 'no_milestones') {
      return 'The selected manifest has no milestones to chain together.';
    }
    if (pathBuild.reason === 'missing_cover') {
      return 'The selected path has no cover content.json in the PR and none published yet.';
    }
    if (pathBuild.reason === 'missing_milestones' && pathBuild.missingMilestones?.length) {
      const catalogNote = catalog ? '' : ' (Could not load the published catalog.)';
      return `These milestones aren't in the PR and aren't published yet: ${pathBuild.missingMilestones.join(', ')}.${catalogNote}`;
    }
    return null;
  }, [hasFetched, effectiveTestMode, pathDiscoveryLoading, hasAnyPathPackage, pathBuild, catalog]);

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
          <RadioButtonGroup options={modeOptions} value={effectiveTestMode} onChange={handleTestModeChange} fullWidth />
        </div>
      )}

      {hasFetched && hasMultipleContentFiles && effectiveTestMode === 'single' && (
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

      {/* Path mode: pick a path + show its milestones in manifest order */}
      {hasFetched && effectiveTestMode === 'path' && (
        <div className={styles.pathOrderContainer}>
          {pathDiscoveryLoading && (
            <p className={styles.helpText}>
              <Icon name="fa fa-spinner" /> Resolving paths…
            </p>
          )}
          {!pathDiscoveryLoading && hasAnyPathPackage && pathCandidates.length > 1 && (
            <div className={styles.selectContainer}>
              <label className={styles.label}>Path package to test</label>
              <Combobox
                options={pathOptions}
                value={selectedPath}
                onChange={handlePathSelect}
                data-testid={testIds.prTester.pathSelect}
              />
            </div>
          )}
          {!pathDiscoveryLoading && pathBuild?.ok && (
            <>
              <label className={styles.label}>Milestones</label>
              <ol className={styles.guidesList}>
                {pathBuild.preview.map((milestone) => (
                  <li key={milestone.id} className={styles.guidesListItem}>
                    <Icon name="document-info" />
                    <span>{milestone.title}</span>
                    <span className={milestone.source === 'pr' ? getStatusClass('modified') : styles.statusBadge}>
                      {milestone.source === 'pr' ? 'from PR' : 'from published'}
                    </span>
                  </li>
                ))}
              </ol>
              {usesPublishedContent && (
                <p className={styles.helpText}>
                  <Icon name="info-circle" /> Unchanged milestones load from the published version, so this reflects the
                  post-merge state.
                </p>
              )}
            </>
          )}
          {!pathDiscoveryLoading && pathBuild && !pathBuild.ok && pathBuild.reason === 'missing_milestones' && (
            <>
              <label className={styles.label}>Milestones</label>
              <ol className={styles.guidesList}>
                {selectedCandidate?.milestoneIds.map((id) => {
                  const isMissing = pathBuild.missingMilestones?.includes(id);
                  return (
                    <li key={id} className={styles.guidesListItem}>
                      <Icon name={isMissing ? 'exclamation-triangle' : 'document-info'} />
                      <span>{id}</span>
                      {isMissing && <span className={getStatusClass('removed')}>not available</span>}
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </div>
      )}

      {hasFetched && effectiveTestMode === 'all' && (
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

      {hasFetched && hasSingleContentFile && effectiveTestMode === 'single' && currentFile && (
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
