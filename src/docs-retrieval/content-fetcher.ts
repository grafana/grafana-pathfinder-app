// Unified content fetcher - replaces docs-fetcher.ts and single-docs-fetcher.ts
// This version ONLY fetches content and extracts basic metadata
// All DOM processing is moved to React components
import {
  RawContent,
  ContentFetchResult,
  ContentFetchOptions,
  ContentType,
  LearningJourneyMetadata,
  Milestone,
} from '../types/content.types';
import type { PackageResolver } from '../types';
import type { ResolvedNavLink } from '../types/context.types';
import { getPackageRenderType } from '../types/package.types';
import { config, getBackendSrv } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';
import { parseUrlSafely, isAllowedContentUrl, isLocalhostUrl, isGitHubRawUrl } from '../security';
import { isDevModeEnabledGlobal } from '../utils/dev-mode';
import { generateJourneyContentWithExtras } from './learning-journey-helpers';
import { resolveRelativeUrls } from './resolve-relative-urls';
import { validateGuide } from '../validation';
import { simpleMarkdownToHtml, wrapExpectBlockInOrangeOutline } from './markdown-renderer';
import { extractMetadata } from './metadata-extractor';
import { fetchBundledInteractive } from './bundled-loader';
import { fetchRawHtml, enforceHttps, type FetchError } from './raw-fetch';

/**
 * Generate a simple ID from a URL for use in wrapped JSON guides.
 */
function generateUrlId(url: string): string {
  // Create a simple hash-like ID from the URL
  const cleanUrl = url.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9]/g, '-');
  return cleanUrl.slice(0, 50);
}

/**
 * Wrap content as a JSON guide for unified rendering.
 * - If content is already a valid JSON guide, return it as-is
 * - If content is HTML, wrap it in a JSON guide with a single html block
 */
function wrapContentAsJsonGuide(content: string, url: string, title: string): string {
  const trimmed = content.trim();

  // Check if already a valid JSON guide
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.id && parsed.title && Array.isArray(parsed.blocks)) {
        return content; // Already a JSON guide
      }
    } catch {
      // Not valid JSON, treat as HTML
    }
  }

  // Wrap HTML in JSON guide structure
  const jsonGuide = {
    id: `external-${generateUrlId(url)}`,
    title: title || 'External Content',
    blocks: [{ type: 'html', content: content }],
  };

  return JSON.stringify(jsonGuide);
}

/**
 * Main unified content fetcher
 * Determines content type and fetches accordingly
 */
export async function fetchContent(url: string, options: ContentFetchOptions = {}): Promise<ContentFetchResult> {
  try {
    // Validate URL
    if (!url || typeof url !== 'string' || url.trim() === '') {
      console.error('fetchContent called with invalid URL:', url);
      return { content: null, error: 'Invalid URL provided', errorType: 'other' };
    }

    // Handle bundled interactive content
    if (url.startsWith('bundled:')) {
      return await fetchBundledInteractive(url);
    }
    // Handle custom guides stored in backend CRDs
    if (url.startsWith('backend-guide:')) {
      return await fetchBackendInteractive(url);
    }

    // SECURITY: Validate URL is from a trusted source before fetching
    // Defense-in-depth: Even if callers validate, fetchContent provides final check
    // In production: Only Grafana docs, interactive learning domains, and bundled content
    // In dev mode: Also allows localhost and GitHub raw URLs for testing
    const isDevMode = isDevModeEnabledGlobal();
    const isTrustedSource = isAllowedContentUrl(url) || (isDevMode && (isLocalhostUrl(url) || isGitHubRawUrl(url)));

    if (!isTrustedSource) {
      const errorMessage = isDevMode
        ? 'Only Grafana.com documentation, interactive learning URLs, localhost URLs, and GitHub raw URLs (dev mode) can be loaded'
        : 'Only Grafana.com documentation and interactive learning URLs can be loaded';

      return {
        content: null,
        error: errorMessage,
        errorType: 'other',
      };
    }

    // Parse hash fragment from URL
    const hashFragment = parseHashFragment(url);
    const cleanUrl = removeHashFragment(url);

    // SECURITY: Enforce HTTPS to prevent MITM attacks
    if (!enforceHttps(cleanUrl)) {
      return {
        content: null,
        error: 'Only HTTPS URLs are allowed for security',
        errorType: 'other',
      };
    }

    // Determine content type based on URL patterns
    const contentType = determineContentType(url);

    // Fetch raw HTML with structured error handling
    const fetchResult = await fetchRawHtml(cleanUrl, options);
    if (!fetchResult.html) {
      // Generate user-friendly error message based on error type
      const userFriendlyError = generateUserFriendlyError(fetchResult.error, cleanUrl);
      return {
        content: null,
        error: userFriendlyError,
        errorType: fetchResult.error?.errorType || 'other',
        statusCode: fetchResult.error?.statusCode,
      };
    }

    // Use the final URL (after redirects) if available, otherwise use the requested URL
    const finalUrl = fetchResult.finalUrl || cleanUrl;

    // Determine if this is native JSON content (content.json) that doesn't need wrapping
    const isNativeJson = fetchResult.isNativeJson || false;

    const metadata = await extractMetadata(fetchResult.html, finalUrl, contentType, isNativeJson);

    let jsonContent: string;

    if (isNativeJson) {
      // Native JSON content - use directly without wrapping
      // Validate it's a proper JSON guide structure
      try {
        const parsed = JSON.parse(fetchResult.html);

        // Check if the server returned null as a signal to fetch unstyled.html
        // JSON.parse("null") returns the JavaScript value null
        if (parsed === null) {
          const htmlUrl = finalUrl.replace('/content.json', '/unstyled.html');
          const htmlFetchResult = await fetchRawHtml(htmlUrl, options);

          if (!htmlFetchResult.html) {
            return {
              content: null,
              error: 'Content not available. The server returned null and no HTML fallback exists.',
              errorType: 'not-found',
            };
          }

          const htmlMetadata = await extractMetadata(htmlFetchResult.html, htmlUrl, contentType, false);
          let processedHtml = htmlFetchResult.html;

          if (contentType === 'learning-journey' && htmlMetadata.learningJourney) {
            processedHtml = generateJourneyContentWithExtras(
              processedHtml,
              htmlMetadata.learningJourney,
              options.skipReadyToBegin
            );
          }

          jsonContent = wrapContentAsJsonGuide(processedHtml, htmlUrl, htmlMetadata.title);

          // Create content with HTML metadata
          const rawContent: RawContent = {
            content: jsonContent,
            metadata: htmlMetadata,
            type: contentType,
            url: htmlUrl,
            lastFetched: new Date().toISOString(),
            hashFragment,
            isNativeJson: false,
          };

          return { content: rawContent };
        }

        const validationResult = validateGuide(parsed);

        if (!validationResult.isValid) {
          // Use the first error message for the main error
          const errorMessage = validationResult.errors[0]?.message || 'Schema validation failed';
          return {
            content: null,
            error: `Invalid guide: ${errorMessage}`,
            errorType: 'other',
          };
        }
        jsonContent = fetchResult.html; // Valid JSON guide
      } catch {
        // Invalid JSON - treat as HTML and wrap
        console.warn('Failed to parse native JSON, treating as HTML');
        jsonContent = wrapContentAsJsonGuide(fetchResult.html, finalUrl, metadata.title);
      }
    } else {
      // HTML content - apply learning journey extras then wrap
      let processedHtml = resolveRelativeUrls(fetchResult.html, finalUrl);
      if (contentType === 'learning-journey' && metadata.learningJourney) {
        processedHtml = generateJourneyContentWithExtras(
          processedHtml,
          metadata.learningJourney,
          options.skipReadyToBegin
        );
      }

      // Wrap content as JSON guide for unified rendering pipeline
      jsonContent = wrapContentAsJsonGuide(processedHtml, finalUrl, metadata.title);
    }

    // Create unified content object
    const rawContent: RawContent = {
      content: jsonContent,
      metadata,
      type: contentType,
      url: finalUrl, // Use final URL to correctly resolve relative links
      lastFetched: new Date().toISOString(),
      hashFragment,
      isNativeJson,
    };

    return { content: rawContent };
  } catch (error) {
    console.error(`Failed to fetch content from ${url}:`, error);
    return {
      content: null,
      error: error instanceof Error ? error.message : 'Unknown error',
      errorType: 'other',
    };
  }
}

interface BackendGuideResource {
  metadata?: {
    name?: string;
  };
  spec?: {
    id?: string;
    title?: string;
    schemaVersion?: string;
    blocks?: unknown[];
  };
}

async function fetchBackendInteractive(url: string): Promise<ContentFetchResult> {
  const resourceName = url.replace('backend-guide:', '').trim();
  const namespace = config.namespace;

  if (!resourceName) {
    return { content: null, error: 'Invalid backend guide resource name', errorType: 'other' };
  }

  if (!namespace) {
    return { content: null, error: 'No namespace available to load custom guide', errorType: 'other' };
  }

  try {
    // SECURITY: Encode resourceName to prevent path traversal (F3)
    const endpoint = `/apis/pathfinderbackend.ext.grafana.com/v1alpha1/namespaces/${namespace}/interactiveguides/${encodeURIComponent(resourceName)}`;
    const response = await lastValueFrom(
      getBackendSrv().fetch<BackendGuideResource>({
        url: endpoint,
        method: 'GET',
        // Optional rollout endpoint: don't show a global toast when unavailable.
        showErrorAlert: false,
      })
    );
    const guideResource = response.data;

    if (!guideResource?.spec?.blocks || !guideResource.spec.title) {
      return {
        content: null,
        error: `Custom guide is missing required fields: ${resourceName}`,
        errorType: 'other',
      };
    }

    const guide = {
      id: guideResource.spec.id || guideResource.metadata?.name || resourceName,
      title: guideResource.spec.title,
      schemaVersion: guideResource.spec.schemaVersion || '1.0',
      blocks: guideResource.spec.blocks,
    };

    const validationResult = validateGuide(guide);
    if (!validationResult.isValid) {
      const errorMessage = validationResult.errors[0]?.message || 'Schema validation failed';
      return {
        content: null,
        error: `Invalid custom guide: ${errorMessage}`,
        errorType: 'other',
      };
    }

    return {
      content: {
        content: JSON.stringify(guide),
        metadata: {
          title: guide.title,
        },
        type: 'interactive',
        url,
        lastFetched: new Date().toISOString(),
      },
    };
  } catch (error) {
    return {
      content: null,
      error: `Failed to load custom guide: ${resourceName}`,
      errorType: 'other',
      statusCode: (error as { status?: number })?.status,
    };
  }
}

/**
 * Generate user-friendly error messages based on error type
 */
function generateUserFriendlyError(error: FetchError | undefined, url: string): string {
  if (!error) {
    return 'Failed to load content. Please try again.';
  }

  switch (error.errorType) {
    case 'not-found':
      return 'Document not found. It may have been moved or removed.';
    case 'timeout':
      return 'Request timed out. Please check your internet connection and try again.';
    case 'network':
      return 'Unable to connect. Please check your internet connection or try again later.';
    case 'server-error':
      return 'Server error occurred. Please try again later.';
    default:
      return error.message || 'Failed to load content. Please try again.';
  }
}

/**
 * Determine content type based on URL patterns
 * Uses proper URL parsing to prevent path injection attacks
 */
function determineContentType(url: string): ContentType {
  // Handle undefined or empty URL
  if (!url || typeof url !== 'string') {
    console.warn('determineContentType called with invalid URL:', url);
    return 'single-doc';
  }

  // Parse URL safely
  const parsedUrl = parseUrlSafely(url);
  if (!parsedUrl) {
    // Invalid URL, treat as single-doc
    return 'single-doc';
  }

  // Check pathname for learning journey indicators
  const pathname = parsedUrl.pathname;

  if (
    pathname.includes('/docs/learning-journeys/') ||
    pathname.includes('/docs/learning-paths/') ||
    pathname.includes('/tutorials/') || // Can be /docs/tutorials/ or /tutorials/
    pathname.match(/\/milestone-\d+/)
  ) {
    return 'learning-journey';
  }

  return 'single-doc';
}

/**
 * Parse and remove hash fragment from URL
 */
function parseHashFragment(url: string): string | undefined {
  const hashIndex = url.indexOf('#');
  if (hashIndex >= 0) {
    return url.substring(hashIndex + 1);
  }
  return undefined;
}

function removeHashFragment(url: string): string {
  const hashIndex = url.indexOf('#');
  if (hashIndex >= 0) {
    return url.substring(0, hashIndex);
  }
  return url;
}

// ---------------------------------------------------------------------------
// Package content integration (Phase 4g)
// ---------------------------------------------------------------------------

/**
 * Module-level PackageResolver injected at Tier 3+ (docs-panel wires the
 * concrete CompositePackageResolver here so docs-retrieval stays decoupled
 * from the package-engine Tier 2 implementation).
 */
let _packageResolver: PackageResolver | undefined;

/**
 * Inject the PackageResolver implementation into docs-retrieval.
 * Called once at app startup by Tier 3/4 wiring code.
 */
export function setPackageResolver(resolver: PackageResolver): void {
  _packageResolver = resolver;
}

/**
 * Derive the grafana.com/docs/learning-paths/ website URL for a milestone.
 * Convention: the milestone package ID shares a prefix with the path slug,
 * and the remainder becomes the URL leaf segment.
 *
 * Example:
 *   pathSlug = "grafana-cloud-tour"
 *   milestoneId = "grafana-cloud-tour-business-value"
 *   → "https://grafana.com/docs/learning-paths/grafana-cloud-tour/business-value/"
 */
export function buildMilestoneWebsiteUrl(pathSlug: string, milestoneId: string): string | undefined {
  const prefix = `${pathSlug}-`;
  if (!milestoneId.startsWith(prefix)) {
    return undefined;
  }
  const slug = milestoneId.slice(prefix.length);
  return `https://grafana.com/docs/learning-paths/${pathSlug}/${slug}/`;
}

/**
 * Derive the path slug from a path-type manifest ID.
 * Strips the conventional `-lj` suffix if present.
 */
export function derivePathSlug(manifestId: string): string {
  return manifestId.endsWith('-lj') ? manifestId.slice(0, -3) : manifestId;
}

/**
 * Resolve manifest milestone IDs into rich Milestone objects via the injected
 * PackageResolver. Each milestone ID is resolved to obtain its contentUrl (used
 * as the navigation URL) and its manifest title. Unresolvable milestones are
 * silently skipped so partial data still renders.
 *
 * @param milestoneIds - Bare package IDs from a path manifest's `milestones` array
 * @param pathSlug - Optional path slug for building website URLs
 * @returns Milestone[] suitable for LearningJourneyMetadata and Recommendation.milestones
 */
export async function resolvePackageMilestones(milestoneIds: string[], pathSlug?: string): Promise<Milestone[]> {
  if (!_packageResolver || milestoneIds.length === 0) {
    return [];
  }

  const settled = await Promise.allSettled(
    milestoneIds.map((id) => _packageResolver!.resolve(id, { loadContent: 'metadata-only' }))
  );

  const milestones: Milestone[] = [];
  let sequenceNumber = 1;

  for (let i = 0; i < milestoneIds.length; i++) {
    const result = settled[i]!;
    const id = milestoneIds[i]!;

    if (result.status === 'rejected') {
      console.warn(`[resolvePackageMilestones] Error resolving milestone ${id}:`, result.reason);
      continue;
    }

    const resolution = result.value;
    if (!resolution.ok) {
      console.warn(`[resolvePackageMilestones] Skipping unresolvable milestone: ${id}`);
      continue;
    }

    const title = resolution.content?.title ?? resolution.manifest?.description ?? id;

    milestones.push({
      number: sequenceNumber++,
      title,
      duration: '5-10 min',
      url: resolution.contentUrl,
      isActive: false,
      ...(pathSlug != null && { websiteUrl: buildMilestoneWebsiteUrl(pathSlug, id) }),
    });
  }

  return milestones;
}

/**
 * Resolve bare package IDs (from manifest `recommends`/`suggests`) into
 * {@link ResolvedNavLink} objects so the context panel can display
 * human-readable titles and open packages with the correct type.
 *
 * Unresolvable IDs are silently skipped.
 */
export async function resolvePackageNavLinks(packageIds: string[]): Promise<ResolvedNavLink[]> {
  if (!_packageResolver || packageIds.length === 0) {
    return [];
  }

  const settled = await Promise.allSettled(
    packageIds.map((id) => _packageResolver!.resolve(id, { loadContent: 'metadata-only' }))
  );

  const links: ResolvedNavLink[] = [];

  for (let i = 0; i < packageIds.length; i++) {
    const result = settled[i]!;
    const id = packageIds[i]!;

    if (result.status === 'rejected') {
      console.warn(`[resolvePackageNavLinks] Error resolving package ${id}:`, result.reason);
      continue;
    }

    const resolution = result.value;
    if (!resolution.ok) {
      console.warn(`[resolvePackageNavLinks] Skipping unresolvable package: ${id}`);
      continue;
    }

    const title = resolution.content?.title ?? resolution.manifest?.description ?? id;
    const manifest: Record<string, unknown> | undefined = resolution.manifest
      ? (resolution.manifest as unknown as Record<string, unknown>)
      : undefined;

    links.push({
      packageId: id,
      title,
      contentUrl: resolution.contentUrl,
      manifest,
    });
  }

  return links;
}

export function isPathManifest(manifest?: Record<string, unknown>): boolean {
  if (!manifest || typeof manifest.type !== 'string') {
    return false;
  }
  return manifest.type === 'path' || manifest.type === 'journey';
}

export function getManifestMilestoneIds(manifest?: Record<string, unknown>): string[] {
  if (!manifest || !Array.isArray(manifest.milestones)) {
    return [];
  }
  return manifest.milestones.filter((s): s is string => typeof s === 'string');
}

/**
 * Fetch package content from a pre-resolved contentUrl (CDN or bundled).
 *
 * This is the primary fetch path for package-backed recommendations.
 * The v1 recommender response already carries a resolved contentUrl, so no
 * resolver call is needed — we fetch directly and enrich with manifest metadata.
 *
 * For path/journey packages, also resolves manifest milestones into
 * LearningJourneyMetadata so the docs panel renders the milestone progress
 * bar and arrow navigation.
 *
 * @param contentUrl - Pre-resolved CDN URL or bundled: URL for the content.json
 * @param packageManifest - Optional manifest metadata to attach to the result
 * @param preResolvedMilestones - Optional milestones already resolved by the caller (avoids redundant resolution)
 */
export async function fetchPackageContent(
  contentUrl: string,
  packageManifest?: Record<string, unknown>,
  preResolvedMilestones?: Milestone[]
): Promise<ContentFetchResult> {
  const renderType = getPackageRenderType(packageManifest);
  const needsMilestones = renderType === 'learning-journey' && isPathManifest(packageManifest);

  const manifestId = needsMilestones && typeof packageManifest?.id === 'string' ? packageManifest.id : '';
  const pathSlug = manifestId ? derivePathSlug(manifestId) : undefined;
  const milestoneIds = needsMilestones ? getManifestMilestoneIds(packageManifest) : [];
  const shouldResolveMilestones =
    needsMilestones && (!preResolvedMilestones || preResolvedMilestones.length === 0) && milestoneIds.length > 0;

  // Run content fetch, milestone resolution, and baseUrl resolution in
  // parallel. These are independent: the page body doesn't need milestones
  // and milestones don't need the page body.
  const [result, resolvedMilestones, baseUrlResolution] = await Promise.all([
    fetchContent(contentUrl),
    shouldResolveMilestones ? resolvePackageMilestones(milestoneIds, pathSlug) : Promise.resolve(undefined),
    manifestId && _packageResolver
      ? _packageResolver.resolve(manifestId, { loadContent: false }).catch(() => undefined)
      : Promise.resolve(undefined),
  ]);

  if (!result.content) {
    return result;
  }

  let learningJourney: LearningJourneyMetadata | undefined;
  let contentString = result.content.content;

  if (needsMilestones) {
    const milestones = preResolvedMilestones?.length ? preResolvedMilestones : resolvedMilestones;

    if (milestones && milestones.length > 0) {
      const milestoneIndex = milestones.findIndex((m) => m.url === contentUrl);
      const currentMilestone = milestoneIndex >= 0 ? milestoneIndex + 1 : 0;

      let baseUrl = contentUrl;
      if (milestoneIndex >= 0 && baseUrlResolution && baseUrlResolution.ok) {
        baseUrl = baseUrlResolution.contentUrl;
      }

      learningJourney = {
        currentMilestone,
        totalMilestones: milestones.length,
        milestones,
        baseUrl,
        summary: result.content.metadata.singleDoc?.summary,
        ...(pathSlug != null && {
          websiteUrl: `https://grafana.com/docs/learning-paths/${pathSlug}/`,
        }),
      };

      if (currentMilestone === 0) {
        contentString = injectJourneyExtrasIntoJsonGuide(contentString, learningJourney);
      }
    }
  }

  return {
    ...result,
    content: {
      ...result.content,
      content: contentString,
      type: renderType,
      metadata: {
        ...result.content.metadata,
        ...(packageManifest !== undefined && { packageManifest }),
        ...(learningJourney !== undefined && { learningJourney }),
      },
    },
  };
}

/**
 * Inject "Ready to begin" button, bottom navigation, and orange-outline-list
 * card styling into JSON guide content for path packages.
 * Falls back to returning the original content if parsing fails.
 */
export function injectJourneyExtrasIntoJsonGuide(jsonContent: string, metadata: LearningJourneyMetadata): string {
  try {
    const parsed = JSON.parse(jsonContent) as {
      id?: string;
      title?: string;
      blocks?: Array<{ type: string; content?: string }>;
    };
    if (!parsed.blocks || !Array.isArray(parsed.blocks)) {
      return jsonContent;
    }

    wrapExpectBlockInOrangeOutline(parsed.blocks);

    const extrasHtml = generateJourneyContentWithExtras('', metadata);

    const htmlParts: string[] = [];
    for (const block of parsed.blocks) {
      if (!block.content) {
        continue;
      }
      if (block.type === 'html') {
        htmlParts.push(block.content);
      } else if (block.type === 'markdown') {
        htmlParts.push(simpleMarkdownToHtml(block.content));
      }
    }

    if (extrasHtml.trim()) {
      htmlParts.push(extrasHtml);
    }

    const merged = {
      id: parsed.id,
      title: parsed.title,
      blocks: [{ type: 'html', content: htmlParts.join('\n') }],
    };

    return JSON.stringify(merged);
  } catch {
    return jsonContent;
  }
}

/**
 * Fetch package content by bare package ID using the injected PackageResolver.
 * Used for deep links and milestone navigation where only an ID is available.
 *
 * Requires setPackageResolver() to have been called first.
 *
 * @param packageId - Bare package ID (e.g., "alerting-101")
 * @param packageManifest - Optional manifest metadata to attach to the result
 */
export async function fetchPackageById(
  packageId: string,
  packageManifest?: Record<string, unknown>
): Promise<ContentFetchResult> {
  if (!_packageResolver) {
    return {
      content: null,
      error: 'No package resolver configured — call setPackageResolver() first',
      errorType: 'other',
    };
  }

  const resolution = await _packageResolver.resolve(packageId, { loadContent: false });

  if (!resolution.ok) {
    return {
      content: null,
      error: `Failed to resolve package: ${packageId}`,
      errorType: resolution.error.code === 'not-found' ? 'not-found' : 'other',
    };
  }

  return fetchPackageContent(resolution.contentUrl, packageManifest);
}
