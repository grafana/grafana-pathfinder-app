// Unified content types for the new retrieval architecture
// This replaces the separate interfaces in docs-fetcher.ts and single-docs-fetcher.ts

export type ContentType = 'learning-journey' | 'single-doc';

export interface RawContent {
  /** Raw content - always a JSON guide string */
  content: string;

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

export interface ContentMetadata {
  /** Extracted title from the content */
  title: string;

  /** Learning journey specific metadata (only present for learning journeys) */
  learningJourney?: LearningJourneyMetadata;

  /** Single doc specific metadata (only present for single docs) */
  singleDoc?: SingleDocMetadata;
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
  duration: string;
  url: string;
  isActive: boolean;
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
  type: 'html_parsing' | 'html_sanitization' | 'element_creation' | 'attribute_mapping' | 'children_processing';
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
