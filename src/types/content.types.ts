// Unified content types for the new retrieval architecture
// This replaces the separate interfaces in docs-fetcher.ts and single-docs-fetcher.ts

export type ContentType = 'learning-journey' | 'single-doc' | 'interactive';

export interface RawContent {
  /** Raw content - always a JSON guide string */
  content: string;

  /**
   * Which tree this payload's canonical block index must be counted from.
   *
   * `content` is the RENDER tree, and on a direct open it is the counting tree
   * too — producers leave this unset. `prepare-guide-launch.ts` hands the
   * renderer a snippet-EXPANDED tree instead, whose block count is not the
   * canonical one (a `snippet-ref` counts as one block however many it expands
   * into), so an expanded payload names its counting tree here.
   *
   * Internal to the content/launch handoff: never author-supplied guide JSON,
   * never fetched from a CDN, never persisted with the tab.
   */
  countingSource?: GuideCountingSource;

  /** Metadata extracted during fetching */
  metadata: ContentMetadata;

  /** Content type determines how it should be processed */
  type: ContentType;

  /** Original URL that was fetched */
  url: string;

  /** When this content was fetched */
  lastFetched: string;

  /** Hash fragment from URL for anchor scrolling */
  hashFragment?: string;

  /** Whether the content was fetched as native JSON (vs HTML that was wrapped) */
  isNativeJson?: boolean;
}

/**
 * The preserved pre-inlining guide an expanded payload was expanded from —
 * the tree `computeGuideBlockIndex` must traverse.
 */
export interface PreInliningCountingSource {
  kind: 'pre-inlining';
  /** Serialized pre-inlining guide. */
  guideJson: string;
}

/**
 * A payload known to be snippet-expanded whose pre-inlining tree was not
 * preserved. Rendering stays available; no canonical index is published from
 * the expanded tree, because that count would not be the canonical one.
 */
export interface UnavailableCountingSource {
  kind: 'unavailable';
}

export type GuideCountingSource = PreInliningCountingSource | UnavailableCountingSource;

/**
 * A `RawContent` whose `content` is snippet-expanded. The counting source is
 * required rather than optional here: an expanded payload that does not carry
 * the tree it was expanded from cannot be counted, so the type makes dropping
 * it a compile error rather than a silent 3-for-2 denominator. Build one with
 * `createPreparedContent` in `src/lib/guide-counting-source.ts`.
 */
export interface PreparedRawContent extends RawContent {
  countingSource: PreInliningCountingSource;
}

export interface ContentMetadata {
  /** Extracted title from the content */
  title: string;

  /** Learning journey specific metadata (only present for learning journeys) */
  learningJourney?: LearningJourneyMetadata;

  /** Single doc specific metadata (only present for single docs) */
  singleDoc?: SingleDocMetadata;

  /**
   * Package manifest metadata — present when content was fetched via fetchPackageContent(),
   * or synthesized by the `backend-guide:` loader for a launch that carries no resolved package.
   * Carries through manifest fields (category, author, recommends, suggests, depends, milestones, etc.)
   * so the content display layer can render richer UI without needing a separate manifest fetch.
   */
  packageManifest?: Record<string, unknown>;

  /**
   * Recommendation-level repository (sibling of the manifest in the V1 wire
   * shape; V1PackageManifest has no repository of its own). Carried alongside
   * packageManifest so completion emission can key the durable
   * `(guideSource, guideId)` on the true source rather than a manifest default.
   */
  repository?: string;
}

export interface LearningJourneyMetadata {
  /** Current milestone number (0 for cover pages) */
  currentMilestone: number;

  /** Total number of milestones */
  totalMilestones: number;

  /** All milestones for this journey */
  milestones: Milestone[];

  /** Journey summary from first few paragraphs */
  summary?: string;

  /** Base URL for the journey (without milestone paths) */
  baseUrl: string;

  /**
   * Public website URL for this journey (e.g., grafana.com/docs/learning-paths/...).
   * Present for package-backed paths so the "Open" button can link to the
   * canonical docs page rather than the CDN content URL.
   */
  websiteUrl?: string;

  /**
   * Named, independently-ordered guide sequences declared on the manifest's
   * `tracks` field (Path Tracks RFC), each resolved to cover-page-ready
   * Milestone rows the same way the default `milestones` above are. Present
   * only for the cover page (currentMilestone === 0) — the only surface that
   * ever renders more than one sequence.
   */
  tracks?: CoverPageTrack[];
}

/** One resolved track: a manifest track's own guides, resolved to rows. */
export interface CoverPageTrack {
  trackId: string;
  label: string;
  milestones: Milestone[];
}

export interface SingleDocMetadata {
  /** Any extracted summary or description */
  summary?: string;

  /** Whether this doc contains interactive elements */
  hasInteractiveElements?: boolean;

  /** Extracted breadcrumb information */
  breadcrumbs?: string[];
}

// Re-export existing interfaces that are still relevant
export interface Milestone {
  number: number;
  title: string;
  /** Author-provided estimate from the member's own manifest. Absent when not authored — never a guessed default. */
  estimatedMinutes?: number;
  url: string;
  isActive: boolean;
  /**
   * True when this milestone's package ID couldn't be resolved (not yet
   * published, or a transient resolver failure) — rendered as visibly
   * unavailable rather than silently dropped from the list, and skipped by
   * next/previous traversal. See RFC CUSTOM-GUIDE-PACKAGES.md §6.5.
   */
  isLocked?: boolean;
  /** Canonical website URL for this milestone (e.g., grafana.com/docs/learning-paths/.../milestone-slug/) */
  websiteUrl?: string;
  /** Short summary shown under the title in the cover-page module list. Package paths only — sourced from the member's manifest description. */
  description?: string;
  /** Author-provided starting location from the member's own manifest. Absent when not authored. */
  startingLocation?: string;
  sideJourneys?: SideJourneys;
  relatedJourneys?: RelatedJourneys;
  conclusionImage?: ConclusionImage;
}

export interface SideJourneys {
  heading: string;
  items: SideJourneyItem[];
}

export interface SideJourneyItem {
  link: string;
  title: string;
}

export interface RelatedJourneys {
  heading: string;
  items: RelatedJourneyItem[];
}

export interface RelatedJourneyItem {
  link: string;
  title: string;
}

export interface ConclusionImage {
  src: string;
  width: number;
  height: number;
}

// Content fetching interfaces
export interface ContentFetchOptions {
  /** Whether to use authentication headers */
  useAuth?: boolean;

  /** Custom headers to include */
  headers?: Record<string, string>;

  /** Timeout in milliseconds */
  timeout?: number;

  /** Whether to follow redirects */
  followRedirects?: boolean;

  /** Skip the "Ready to begin?" button on learning journey cover pages */
  skipReadyToBegin?: boolean;
}

export interface ContentFetchResult {
  /** The raw content, or null if fetch failed */
  content: RawContent | null;

  /** Error message if fetch failed */
  error?: string;

  /** Error type for better handling */
  errorType?: 'not-found' | 'timeout' | 'network' | 'server-error' | 'other';

  /** HTTP status code if available */
  statusCode?: number;
}

// Parsing error types for fail-fast content rendering
export interface ParseError {
  type:
    | 'html_parsing'
    | 'html_sanitization'
    | 'element_creation'
    | 'attribute_mapping'
    | 'children_processing'
    | 'schema_validation';
  message: string;
  element?: string; // HTML snippet that caused the error
  location?: string; // Where in the parsing process the error occurred
  originalError?: Error;
}

export interface ParseResult<T> {
  isValid: boolean;
  data?: T;
  errors: ParseError[];
  warnings: string[];
}

// These interfaces are defined in html-parser.ts and re-exported
export interface ParsedElement {
  type: string;
  props: Record<string, any>;
  children: Array<ParsedElement | string>;
  originalHTML?: string;
}

export interface ParsedContent {
  elements: ParsedElement[];
  hasInteractiveElements: boolean;
  hasCodeBlocks: boolean;
  hasExpandableTables: boolean;
  hasImages: boolean;
  hasVideos: boolean;
  hasAssistantElements: boolean;
}

// Extend existing interfaces with the new result pattern
export type ContentParseResult = ParseResult<ParsedContent>;
