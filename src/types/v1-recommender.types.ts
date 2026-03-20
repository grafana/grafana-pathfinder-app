/**
 * V1 Recommender API Response Types
 *
 * TypeScript types matching the recommender's OpenAPI spec for versioned
 * endpoints: POST /api/v1/recommend and GET /api/v1/packages/{id}.
 *
 * The OpenAPI spec (openapi.yaml in grafana-recommender) is the source of
 * truth for field names and nesting.
 *
 * @coupling OpenAPI spec: grafana-recommender openapi.yaml — V1Recommendation,
 *   V1PackageManifest, V1RecommenderResponse, PackageResolutionResponse,
 *   PackageResolutionError schemas
 */

/**
 * Author metadata from repository.json, nested in V1PackageManifest.
 */
export interface V1AuthorInfo {
  name?: string;
  team?: string;
}

/**
 * Package metadata nested inside a package-backed V1Recommendation.
 * Carries manifest-derived fields: identity, type, dependency/navigation
 * arrays, and optional display metadata.
 *
 * Navigation fields (recommends, suggests, depends) are flat arrays here —
 * there is no `navigation` wrapper object. Phase 5 will add `memberOf`.
 */
export interface V1PackageManifest {
  id: string;
  type: string;
  description?: string;
  category?: string;
  author?: V1AuthorInfo;
  startingLocation?: string;
  milestones?: string[];
  depends?: string[];
  recommends?: string[];
  suggests?: string[];
  provides?: string[];
  conflicts?: string[];
  replaces?: string[];
}

/**
 * A single recommendation from POST /api/v1/recommend.
 *
 * Discriminated on `type`:
 * - `type === "package"` → package-backed: `contentUrl`, `manifestUrl`,
 *   `repository`, and `manifest` are populated; `url` is absent.
 * - Any other `type` → URL-backed: `url` is populated; package fields absent.
 *
 * `contentUrl`/`manifestUrl` may be empty strings when the package ID was not
 * found in the cached repository index at response time — the recommendation
 * is still surfaced for graceful client-side degradation.
 */
export interface V1Recommendation {
  type: string;
  title: string;
  description?: string;
  source?: string;
  matchAccuracy?: number;
  matchedCriteria?: string[];
  missingCriteria?: string[];

  /** URL-backed recommendations */
  url?: string;

  /** Package-backed recommendations */
  contentUrl?: string;
  manifestUrl?: string;
  repository?: string;
  manifest?: V1PackageManifest;
}

/**
 * Response body from POST /api/v1/recommend.
 */
export interface V1RecommenderResponse {
  recommendations: V1Recommendation[];
  featured?: V1Recommendation[];
}

/**
 * Successful response from GET /api/v1/packages/{id}.
 */
export interface V1PackageResolutionResponse {
  id: string;
  contentUrl: string;
  manifestUrl: string;
  repository: string;
}

/**
 * Error response from GET /api/v1/packages/{id}.
 */
export interface V1PackageResolutionError {
  error: string;
  code: 'not-found' | 'bad-request';
}

/**
 * Type guard: identifies package-backed recommendations.
 * Checks `type === "package"` and presence of the `manifest` object.
 */
export function isPackageRecommendation(
  rec: V1Recommendation
): rec is V1Recommendation & { manifest: V1PackageManifest } {
  return rec.type === 'package' && rec.manifest != null;
}
