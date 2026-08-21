/**
 * Hook for managing guide persistence to backend
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { getBackendSrv, config } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';
import type { JsonGuide } from '../types';
import { fetchBackendGuides } from '../../../utils/fetchBackendGuides';
import { APP_PLATFORM_API_VERSION, collectionUrl, itemUrl } from '../../../utils/interactive-guides-api';
import { stripAuthorNotes } from '../utils/block-export';
import { deriveManifest } from '../utils/derive-manifest';
import { CURRENT_SCHEMA_VERSION } from '../../../types/json-guide.schema';
import { logger } from '../../../lib/logging';

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
  blocks: any[];
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
 * `milestones`.
 */
export function preservedSpec(
  guide: JsonGuide,
  status: 'draft' | 'published',
  existingSpec?: BackendGuideSpec | null
): BackendGuideSpec {
  return {
    ...(existingSpec ?? {}),
    id: guide.id,
    title: guide.title,
    // Normalised deliberately: the editor writes the schema version it emits, not the stored one.
    schemaVersion: guide.schemaVersion || CURRENT_SCHEMA_VERSION,
    blocks: guide.blocks,
    status,
    manifest: deriveManifest(guide, asManifestRecord(existingSpec?.manifest)),
  };
}

/** `spec.manifest` is untyped on the wire; narrow it before merging. */
function asManifestRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

export interface UseBackendGuidesReturn {
  guides: BackendGuide[];
  isLoading: boolean;
  error: string | null;
  /** True once the initial fetch has resolved (success or failure). */
  hasLoaded: boolean;
  refreshGuides: () => Promise<BackendGuide[]>;
  saveGuide: (
    guide: JsonGuide,
    existingResourceName?: string,
    existingMetadata?: Partial<BackendGuideMetadata> | null,
    status?: 'draft' | 'published',
    replacesForeignResource?: boolean
  ) => Promise<void>;
  publishGuide: (resourceName: string, currentMetadata: Partial<BackendGuideMetadata> | null) => Promise<void>;
  unpublishGuide: (resourceName: string, currentMetadata: Partial<BackendGuideMetadata> | null) => Promise<void>;
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
  const [guides, setGuides] = useState<BackendGuide[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  const namespace = config.namespace;

  /**
   * Fetch all guides from backend
   */
  const isMountedRef = useRef(true);
  const refreshGuides = useCallback(async (): Promise<BackendGuide[]> => {
    if (!namespace) {
      if (isMountedRef.current) {
        setError('No namespace available');
      }
      return [];
    }

    if (isMountedRef.current) {
      setIsLoading(true);
      setError(null);
    }

    try {
      const fetchedGuides = await fetchBackendGuides(namespace);
      if (isMountedRef.current) {
        setGuides(fetchedGuides);
      }
      return fetchedGuides;
    } catch (err) {
      logger.error('[useBackendGuides] Failed to fetch guides', { error: err });
      if (isMountedRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to fetch guides');
      }
      return [];
    } finally {
      if (isMountedRef.current) {
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
      replacesForeignResource = false
    ) => {
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

        let existing = existingResourceName ? guides.find((g) => g.metadata.name === existingResourceName) : undefined;
        // An absent entry does not mean an absent resource: a transient LIST failure resolves to an
        // empty list rather than an error, so confirm with the server before refusing. Without this
        // one failed refresh would make the guide permanently unsaveable. Probed rather than
        // refreshed: committing the result would clear a live error and store an empty catalogue,
        // hiding the guide-library entry that is the only way back.
        if (existingResourceName && !existing) {
          const probed = await fetchBackendGuides(namespace);
          existing = probed.find((g) => g.metadata.name === existingResourceName);
        }
        // Fail closed rather than replace a resource whose current spec is not in hand: the write
        // would drop spec.manifest and the provenance annotations, and with no resourceVersion it
        // would not even 409 against a concurrent writer.
        if (existingResourceName && !existing) {
          throw new Error(`Could not read the saved guide "${existingResourceName}" — try saving again.`);
        }

        // Caller metadata wins per field, not wholesale — partial metadata must not suppress the
        // snapshot's resourceVersion and take the conflict check with it.
        const priorMetadata = existing ? { ...existing.metadata, ...(existingMetadata ?? {}) } : undefined;

        // A name-collision overwrite writes a guide that did not come from the stored resource, so
        // inheriting its manifest would render this guide as that path, and inheriting its
        // provenance annotations would let the upload script's ownership guard pass on content it
        // never wrote.
        const inheritUnowned = !replacesForeignResource;
        const metadata = preservedMetadata(resourceName, namespace, priorMetadata, inheritUnowned);

        // Author notes are private to the editor session and must never be persisted.
        const exportable = stripAuthorNotes(guide);

        const k8sResource = {
          apiVersion: APP_PLATFORM_API_VERSION,
          kind: 'InteractiveGuide',
          metadata,
          spec: preservedSpec(exportable, status, inheritUnowned ? existing?.spec : undefined),
        };

        await lastValueFrom(
          getBackendSrv().fetch({
            url: existingResourceName ? itemUrl(namespace, existingResourceName) : collectionUrl(namespace),
            method: existingResourceName ? 'PUT' : 'POST',
            data: k8sResource,
            showErrorAlert: false,
          })
        );

        await refreshGuides();
      } finally {
        setIsSaving(false);
      }
    },
    [namespace, guides, refreshGuides]
  );

  /**
   * Publish an existing guide — sets spec.status to 'published' without changing content.
   */
  const publishGuide = useCallback(
    async (resourceName: string, currentMetadata: Partial<BackendGuideMetadata> | null) => {
      if (!namespace) {
        throw new Error('No namespace available');
      }

      setIsSaving(true);
      try {
        const existing = guides.find((g) => g.metadata.name === resourceName);
        if (!existing) {
          throw new Error(`Guide "${resourceName}" not found in local list`);
        }

        const metadata = preservedMetadata(resourceName, namespace, {
          ...existing.metadata,
          ...(currentMetadata ?? {}),
        });

        await lastValueFrom(
          getBackendSrv().fetch({
            url: itemUrl(namespace, resourceName),
            method: 'PUT',
            data: {
              apiVersion: APP_PLATFORM_API_VERSION,
              kind: 'InteractiveGuide',
              metadata,
              spec: { ...existing.spec, status: 'published' as const },
            },
            showErrorAlert: false,
          })
        );

        await refreshGuides();
      } finally {
        setIsSaving(false);
      }
    },
    [namespace, guides, refreshGuides]
  );

  /**
   * Unpublish a guide — sets spec.status to 'draft', removing it from the docs panel.
   */
  const unpublishGuide = useCallback(
    async (resourceName: string, currentMetadata: Partial<BackendGuideMetadata> | null) => {
      if (!namespace) {
        throw new Error('No namespace available');
      }

      setIsSaving(true);
      try {
        const existing = guides.find((g) => g.metadata.name === resourceName);
        if (!existing) {
          throw new Error(`Guide "${resourceName}" not found in local list`);
        }

        const metadata = preservedMetadata(resourceName, namespace, {
          ...existing.metadata,
          ...(currentMetadata ?? {}),
        });

        await lastValueFrom(
          getBackendSrv().fetch({
            url: itemUrl(namespace, resourceName),
            method: 'PUT',
            data: {
              apiVersion: APP_PLATFORM_API_VERSION,
              kind: 'InteractiveGuide',
              metadata,
              spec: { ...existing.spec, status: 'draft' as const },
            },
            showErrorAlert: false,
          })
        );

        await refreshGuides();
      } finally {
        setIsSaving(false);
      }
    },
    [namespace, guides, refreshGuides]
  );

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
    saveGuide,
    publishGuide,
    unpublishGuide,
    deleteGuide,
    isSaving,
  };
}
