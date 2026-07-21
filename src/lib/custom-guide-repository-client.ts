/**
 * Client for the /custom-guide-repository backend proxy — a slim,
 * denormalized catalogue of the caller's private InteractiveGuide packages
 * (the App Platform analogue of the CDN's repository.json), computed live by
 * pkg/plugin/custom_guide_repository.go rather than pre-built.
 *
 * Consumed by the Custom Guides surface and My Learning ingestion to
 * enumerate path/journey packages without pulling every guide's full
 * content.json just to build a catalogue view.
 *
 * @coupling API: GET /custom-guide-repository served by pkg/plugin/custom_guide_repository.go
 */
import { getBackendSrv } from '@grafana/runtime';

import { PLUGIN_BACKEND_URL } from '../constants';
import { isBackendApiAvailable } from '../utils/fetchBackendGuides';
import type { Author, DependencyList, PackageType } from '../types/package.types';

export interface CustomGuideManifest {
  type: PackageType;
  repository?: string;
  description?: string;
  milestones?: string[];
  category?: string;
  author?: Author;
  depends?: DependencyList;
}

export interface CustomGuideRepositoryEntry {
  id: string;
  title?: string;
  status?: string;
  manifest?: CustomGuideManifest;
}

interface CustomGuideRepositoryResponse {
  namespace: string;
  guides: CustomGuideRepositoryEntry[];
}

const CUSTOM_GUIDE_REPOSITORY_URL = `${PLUGIN_BACKEND_URL}/custom-guide-repository`;

/**
 * Fetch the caller's custom guide catalogue for the current namespace.
 * Returns an empty array when the backend API isn't rolled out, the caller
 * has no namespace, or the request fails for any reason — this is a
 * best-effort listing, not a hard dependency (mirrors fetchBackendGuides).
 */
export async function fetchCustomGuideRepository(namespace: string): Promise<CustomGuideRepositoryEntry[]> {
  if (!isBackendApiAvailable() || !namespace) {
    return [];
  }

  try {
    const response = await getBackendSrv().get<CustomGuideRepositoryResponse>(
      CUSTOM_GUIDE_REPOSITORY_URL,
      { namespace },
      undefined,
      { showErrorAlert: false, showSuccessAlert: false }
    );
    return Array.isArray(response?.guides) ? response.guides : [];
  } catch {
    return [];
  }
}
