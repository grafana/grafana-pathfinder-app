/**
 * Hook for managing guide persistence to backend
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { getBackendSrv, config } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';
import type { JsonGuide } from '../types';
import {
  fetchCustomGuideCatalogue,
  type CustomGuideRepositoryEntry,
} from '../../../lib/custom-guide-repository-client';
import { APP_PLATFORM_API_VERSION, collectionUrl, guideReadUrl, itemUrl } from '../../../utils/interactive-guides-api';
import { stripAuthorNotes } from '../utils/block-export';
import {
  APP_PLATFORM_REPOSITORY,
  applyAuthor,
  deriveManifest,
  PLAIN_GUIDE_TYPE,
  resolveAuthor,
  type DefaultedAuthor,
  type GuideDetails,
} from '../utils/derive-manifest';
import { currentUserAuthorName } from '../../../utils/current-user-name';
import { CURRENT_SCHEMA_VERSION } from '../../../types/json-guide.schema';
import { logger } from '../../../lib/logging';
import { extractFetchErrorStatus } from '../../../lib/fetch-error';
import { encodeAppPlatformGuideBlocks } from '../../../types/app-platform-guide-compat';

export type BackendGuideMetadata = {
  name: string;
  namespace: string;
  creationTimestamp?: string;
  uid?: string;
  resourceVersion?: string;
  annotations?: Record<string, string>;
  labels?: Record<string, string>;
};

export interface BackendGuideSpec {
  id: string;
  title: string;
  schemaVersion?: string;
  blocks: unknown[];
  status?: 'draft' | 'published';
  /** Package metadata. Absent on legacy content-only guides; derived on every editor save. */
  manifest?: Record<string, unknown>;
  [unownedField: string]: unknown;
}

interface BackendGuide {
  metadata: BackendGuideMetadata;
  spec: BackendGuideSpec;
}

/**
 * A PUT replaces the whole object, so metadata the editor does not own must be carried through.
 * `inheritUnowned: false` keeps the resourceVersion guard but drops annotations and labels — see
 * `preservedSpec`.
 */
export function preservedMetadata(
  resourceName: string,
  namespace: string,
  existingMetadata?: Partial<BackendGuideMetadata> | null,
  inheritUnowned = true
): Record<string, unknown> {
  const metadata: Record<string, unknown> = { name: resourceName, namespace };
  if (!existingMetadata) {
    return metadata;
  }
  if (existingMetadata.resourceVersion !== undefined) {
    metadata.resourceVersion = existingMetadata.resourceVersion;
  }
  if (!inheritUnowned) {
    return metadata;
  }
  if (existingMetadata.annotations) {
    metadata.annotations = existingMetadata.annotations;
  }
  if (existingMetadata.labels) {
    metadata.labels = existingMetadata.labels;
  }
  return metadata;
}

/**
 * Editor-owned fields layered over the spec last read, so `spec.manifest` survives the replace.
 *
 * `manifest` is derived rather than passed through untouched: an editor-authored guide has to be a
 * complete package, not manifest-less content. `deriveManifest` merges over the inherited manifest and
 * owns only what it can compute from the blocks, so a path cover page keeps its `type` and
 * `milestones`. It gets the previously-read BLOCKS as well as the previously-read manifest, because
 * deciding whether the editor owns `startingLocation` means asking what that content derived.
 * `details` carries the author's explicit guide-details choices.
 */
export function preservedSpec(
  guide: JsonGuide,
  status: 'draft' | 'published',
  existingSpec?: BackendGuideSpec | null,
  details?: GuideDetails
): BackendGuideSpec {
  return {
    ...(existingSpec ?? {}),
    id: guide.id,
    title: guide.title,
    // Normalised deliberately: the editor writes the schema version it emits, not the stored one.
    schemaVersion: guide.schemaVersion || CURRENT_SCHEMA_VERSION,
    blocks: encodeAppPlatformGuideBlocks(guide.blocks),
    status,
    manifest: deriveManifest(guide, existingSpec?.manifest, existingSpec?.blocks, {
      signedInName: currentUserAuthorName(),
      details,
    }),
  };
}

/** The base a legacy manifest-less guide gets when publish or unpublish has to hold an author. */
const MINTED_MANIFEST = { type: PLAIN_GUIDE_TYPE, repository: APP_PLATFORM_REPOSITORY };

/**
 * Publish and unpublish re-PUT the stored spec rather than re-deriving it, so the author default is
 * layered on here alone: nothing else about the manifest is the editor's to recompute from a status flip.
 */
function specWithAuthorDefault(spec: BackendGuideSpec, status: 'draft' | 'published'): BackendGuideSpec {
  return {
    ...spec,
    status,
    manifest: applyAuthor(spec.manifest ?? MINTED_MANIFEST, { signedInName: currentUserAuthorName() }),
  };
}

/**
 * The stored resource, read singly. The library's catalogue cannot stand in for it: entries carry no
 * blocks and no resourceVersion. Only a 404 means the guide is gone; any other failure becomes an
 * Error, because the save flow shows `message` only for Error instances.
 */
async function readStoredGuide(resourceName: string): Promise<BackendGuide | undefined> {
  try {
    const response = await lastValueFrom(
      getBackendSrv().fetch<BackendGuide>({ url: guideReadUrl(resourceName), method: 'GET', showErrorAlert: false })
    );
    return response.data;
  } catch (err) {
    const status = extractFetchErrorStatus(err);
    if (status === 404) {
      return undefined;
    }
    // Grafana errors carry `data.message`; the plugin proxy writes its reason as `data.error`.
    const data = (err as { data?: { message?: string; error?: string } } | null)?.data;
    const reason = data?.message || data?.error || (err instanceof Error ? err.message : 'request failed');
    const suffix = status === undefined ? '' : ` (HTTP ${status})`;
    throw Object.assign(new Error(`Could not read the saved guide "${resourceName}": ${reason}${suffix}`), { status });
  }
}

/** What a save tells the editor about the author it wrote. */
export interface SaveGuideResult {
  /** The name this save chose for the guide, set only when it was not already authored by a real name. */
  defaultedAuthor?: DefaultedAuthor;
  /** The resource the write answered with, carrying the resourceVersion the next save must echo. */
  written?: BackendGuide;
}

/** The stored resource a write answered with, when the answer is one. */
function writtenResource(data: unknown, resourceName: string): BackendGuide | undefined {
  const resource = data as Partial<BackendGuide> | null | undefined;
  return resource?.metadata?.name === resourceName && resource.metadata.resourceVersion && resource.spec
    ? (resource as BackendGuide)
    : undefined;
}

export interface UseBackendGuidesReturn {
  /** The library's slim catalogue: no blocks, no resourceVersion. Read a guide with `readGuide`. */
  guides: CustomGuideRepositoryEntry[];
  isLoading: boolean;
  error: string | null;
  /** True once the initial fetch has resolved (success or failure). */
  hasLoaded: boolean;
  refreshGuides: () => Promise<CustomGuideRepositoryEntry[]>;
  readGuide: (resourceName: string) => Promise<BackendGuide | undefined>;
  saveGuide: (
    guide: JsonGuide,
    existingResourceName?: string,
    existingMetadata?: Partial<BackendGuideMetadata> | null,
    status?: 'draft' | 'published',
    replacesForeignResource?: boolean,
    details?: GuideDetails
  ) => Promise<SaveGuideResult>;
  publishGuide: (resourceName: string) => Promise<BackendGuide | undefined>;
  unpublishGuide: (resourceName: string) => Promise<BackendGuide | undefined>;
  deleteGuide: (resourceName: string) => Promise<void>;
  isSaving: boolean;
}

// Keep the guide Library entry available while the list is still loading or
// after a failed fetch; report "no guides" only once an initial fetch has
// confirmed an empty list, so the entry neither flash-hides for existing users
// nor gets stuck hidden on error.
export function hasManageableBackendGuides(
  state: Pick<UseBackendGuidesReturn, 'guides' | 'error' | 'hasLoaded'>
): boolean {
  if (!state.hasLoaded || state.error !== null) {
    return true;
  }
  return state.guides.length > 0;
}

/**
 * Hook to manage guides from the Pathfinder backend
 */
export function useBackendGuides(): UseBackendGuidesReturn {
  const [guides, setGuides] = useState<CustomGuideRepositoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  const namespace = config.namespace;

  const isMountedRef = useRef(true);
  // Refreshes overlap (mount, then one after every write), and a catalogue drain can be slow, so only the
  // latest one may write state: an older drain landing last would restore pre-write rows or a stale error.
  const refreshSeq = useRef(0);
  const refreshGuides = useCallback(async (): Promise<CustomGuideRepositoryEntry[]> => {
    if (!namespace) {
      if (isMountedRef.current) {
        setError('No namespace available');
      }
      return [];
    }

    const seq = ++refreshSeq.current;
    const isLatest = () => isMountedRef.current && seq === refreshSeq.current;
    if (isMountedRef.current) {
      setIsLoading(true);
      setError(null);
    }

    try {
      // Bypasses the client cache so a guide just saved or deleted shows up as such.
      const catalogue = await fetchCustomGuideCatalogue(namespace, { refresh: true });
      // An unavailable catalogue is an empty list on the wire; showing it as "no guides" would hide them all.
      if (!catalogue.available && catalogue.reason !== 'unsupported') {
        throw new Error(`The guide library is unavailable (${catalogue.reason ?? 'unknown'}).`);
      }
      if (isLatest()) {
        setGuides(catalogue.entries);
      }
      return catalogue.entries;
    } catch (err) {
      logger.error('[useBackendGuides] Failed to fetch guides', { error: err });
      if (isLatest()) {
        setError(err instanceof Error ? err.message : 'Failed to fetch guides');
      }
      return [];
    } finally {
      if (isLatest()) {
        setIsLoading(false);
        setHasLoaded(true);
      }
    }
  }, [namespace]);

  /**
   * Save guide to backend (create new or update existing).
   * Defaults to 'draft' status — saving never auto-publishes.
   */
  const saveGuide = useCallback(
    async (
      guide: JsonGuide,
      existingResourceName?: string,
      existingMetadata?: Partial<BackendGuideMetadata> | null,
      status: 'draft' | 'published' = 'draft',
      replacesForeignResource = false,
      details?: GuideDetails
    ): Promise<SaveGuideResult> => {
      if (!namespace) {
        throw new Error('No namespace available');
      }

      setIsSaving(true);
      try {
        const resourceName =
          existingResourceName ||
          (guide.id || guide.title)
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');

        if (!resourceName || resourceName.length === 0) {
          throw new Error('Guide title or ID must contain at least one alphanumeric character');
        }

        const existing = existingResourceName ? await readStoredGuide(existingResourceName) : undefined;
        // Fail closed rather than replace a resource whose current spec is not in hand: the write
        // would drop spec.manifest and the provenance annotations, and with no resourceVersion it
        // would not even 409 against a concurrent writer.
        if (existingResourceName && !existing) {
          throw new Error(`Could not read the saved guide "${existingResourceName}" — try saving again.`);
        }

        // Caller metadata wins per field: its resourceVersion is the version the editor's content is
        // based on, so a concurrent write still 409s. Partial metadata falls back to the read's.
        const priorMetadata = existing ? { ...existing.metadata, ...(existingMetadata ?? {}) } : undefined;

        // A name-collision overwrite writes a guide that did not come from the stored resource, so
        // inheriting its manifest would render this guide as that path, and inheriting its
        // provenance annotations would let the upload script's ownership guard pass on content it
        // never wrote.
        const inheritUnowned = !replacesForeignResource;
        const metadata = preservedMetadata(resourceName, namespace, priorMetadata, inheritUnowned);

        // Author notes are private to the editor session and must never be persisted.
        const exportable = stripAuthorNotes(guide);

        const inheritedSpec = inheritUnowned ? existing?.spec : undefined;
        const k8sResource = {
          apiVersion: APP_PLATFORM_API_VERSION,
          kind: 'InteractiveGuide',
          metadata,
          spec: preservedSpec(exportable, status, inheritedSpec, details),
        };
        const defaultedAuthor = resolveAuthor(inheritedSpec?.manifest?.author, {
          signedInName: currentUserAuthorName(),
          details,
        })?.defaulted;

        const response = await lastValueFrom(
          getBackendSrv().fetch<unknown>({
            url: existingResourceName ? itemUrl(namespace, existingResourceName) : collectionUrl(namespace),
            method: existingResourceName ? 'PUT' : 'POST',
            data: k8sResource,
            showErrorAlert: false,
          })
        );

        await refreshGuides();
        return { defaultedAuthor, written: writtenResource(response.data, resourceName) };
      } finally {
        setIsSaving(false);
      }
    },
    [namespace, refreshGuides]
  );

  /**
   * Re-PUT the stored spec with only its status flipped. Metadata comes from the read alone: the
   * content written is the stored content, so there is no editor-held version to conflict against.
   */
  const writeStatus = useCallback(
    async (resourceName: string, status: 'draft' | 'published'): Promise<BackendGuide | undefined> => {
      if (!namespace) {
        throw new Error('No namespace available');
      }

      setIsSaving(true);
      try {
        const existing = await readStoredGuide(resourceName);
        if (!existing) {
          throw new Error(`Guide "${resourceName}" was not found on the server`);
        }

        const response = await lastValueFrom(
          getBackendSrv().fetch<unknown>({
            url: itemUrl(namespace, resourceName),
            method: 'PUT',
            data: {
              apiVersion: APP_PLATFORM_API_VERSION,
              kind: 'InteractiveGuide',
              metadata: preservedMetadata(resourceName, namespace, existing.metadata),
              spec: specWithAuthorDefault(existing.spec, status),
            },
            showErrorAlert: false,
          })
        );

        await refreshGuides();
        return writtenResource(response.data, resourceName);
      } finally {
        setIsSaving(false);
      }
    },
    [namespace, refreshGuides]
  );

  const publishGuide = useCallback((resourceName: string) => writeStatus(resourceName, 'published'), [writeStatus]);

  /** Sets the guide back to draft, removing it from the docs panel. */
  const unpublishGuide = useCallback((resourceName: string) => writeStatus(resourceName, 'draft'), [writeStatus]);

  /**
   * Delete guide from backend
   */
  const deleteGuide = useCallback(
    async (resourceName: string) => {
      if (!namespace) {
        throw new Error('No namespace available');
      }

      try {
        await lastValueFrom(
          getBackendSrv().fetch({
            url: itemUrl(namespace, resourceName),
            method: 'DELETE',
            showErrorAlert: false,
          })
        );

        // Refresh the list after deleting
        await refreshGuides();
      } catch (err) {
        logger.error('[useBackendGuides] Failed to delete guide', { error: err });
        throw err;
      }
    },
    [namespace, refreshGuides]
  );

  // Load guides on mount only
  const hasInitiallyLoaded = useRef(false);
  useEffect(() => {
    isMountedRef.current = true;
    if (!hasInitiallyLoaded.current) {
      hasInitiallyLoaded.current = true;
      refreshGuides();
    }
    return () => {
      isMountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    guides,
    isLoading,
    error,
    hasLoaded,
    refreshGuides,
    readGuide: readStoredGuide,
    saveGuide,
    publishGuide,
    unpublishGuide,
    deleteGuide,
    isSaving,
  };
}
