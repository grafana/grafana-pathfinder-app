/**
 * V1 Recommender API Types
 *
 * TypeScript types matching the recommender's OpenAPI V1 schemas for
 * `POST /api/v1/recommend` and `GET /api/v1/packages/{id}`.
 *
 * These are Tier 0 types — importable by engines, UI, CLI, and validation.
 *
 * @coupling Recommender OpenAPI: openapi.yaml in grafana-recommender
 */

import type { Author, PackageType } from './package.types';

// ============ NAVIGATION ============

/**
 * Structural navigation links carried in v1 responses.
 * `memberOf` is NOT in Phase 4d — it arrives in Phase 5.
 */
export interface PackageNavigation {
  recommends?: string[];
  suggests?: string[];
  depends?: string[];
}

// ============ V1 RECOMMENDATION ============

/**
 * A single recommendation item from `POST /api/v1/recommend`.
 *
 * Discriminated union on `type`:
 * - `type === "package"` → package-backed; has `packageId`, `contentUrl`, `manifestUrl`, etc.
 * - any other `type`   → URL-backed; has `url`.
 *
 * Use `isPackageRecommendation()` to narrow the type at runtime.
 */
export interface V1Recommendation {
  /** Content type. "package" signals a package-backed item; all other values are URL-backed. */
  type: string;
  /** Display title. Always present. */
  title: string;
  /** Short description or summary. */
  description?: string;
  /** Content source identifier (e.g., "package", "rules"). */
  source?: string;
  /** Match accuracy score, 0–1. */
  matchAccuracy?: number;
  /** Criteria that matched the user's context. */
  matchedCriteria?: string[];
  /** Criteria that were not met. */
  missingCriteria?: string[];

  // URL-backed fields (present when type !== "package")
  /** Destination URL for URL-backed recommendations. */
  url?: string;

  // Package-backed fields (present when type === "package")
  /** Bare package ID (e.g., "alerting-101"). */
  packageId?: string;
  /** CDN URL for the package's content.json. */
  contentUrl?: string;
  /** CDN URL for the package's manifest.json. */
  manifestUrl?: string;
  /** Repository name the package belongs to. */
  repository?: string;
  /** Package type: "guide", "path", or "journey". */
  packageType?: PackageType;
  /** Content category. */
  category?: string;
  /** Content author. */
  author?: Author;
  /** Grafana URL where this package is best experienced. */
  startingLocation?: string;
  /**
   * Milestone step IDs for path-type packages.
   * Structural list; completion overlay is computed client-side.
   */
  milestones?: string[];
  /**
   * Navigation links from the dependency graph.
   * Phase 4d: recommends/suggests/depends only.
   * Phase 5 adds memberOf.
   */
  navigation?: PackageNavigation;
}

// ============ V1 RESPONSE ============

/**
 * Response body from `POST /api/v1/recommend`.
 */
export interface V1RecommenderResponse {
  recommendations: V1Recommendation[];
  /** Curated featured items, server-ordered. */
  featured?: V1Recommendation[];
}

// ============ TYPE GUARD ============

/**
 * Narrows a `V1Recommendation` to a package-backed item.
 * Package-backed items have `type === "package"` and `packageId`.
 */
export function isPackageRecommendation(
  rec: V1Recommendation
): rec is V1Recommendation & { packageId: string; contentUrl: string; manifestUrl: string; repository: string } {
  return rec.type === 'package' && typeof rec.packageId === 'string' && rec.packageId.length > 0;
}
