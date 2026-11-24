/**
 * The one place that decides which family a docs URL belongs to: a legacy
 * learning path or journey, a tutorial, Grafana Learn, standard docs, an
 * interactive-learning guide, or something else. Every journey-versus-document
 * routing decision reads the result here instead of matching path strings, and
 * `src/validation/docs-url-family-literal.test.ts` fails on a new hand-written
 * predicate elsewhere. Design: `docs/design/GRAFANA_LEARN.md`.
 *
 * Classification is structural, never a trust decision. A caller that fetches
 * or opens the URL still passes it through the trust gate in
 * `src/security/url-validator.ts`. The legacy families keep matching on the
 * path alone, as every predicate this module replaced did, so a foreign host
 * that echoes `/docs/learning-paths/` still classifies as one (private-guide
 * eligibility depends on that). `learn` is new and born host-gated.
 */

import { isGrafanaDocsUrl, isGrafanaDomain, isInteractiveLearningUrl, parseUrlSafely } from '../security/url-validator';
import { stripContentFile } from './guide-content-file';

export type DocsUrlFamily =
  'learning-path' | 'legacy-learning-journey' | 'tutorial' | 'learn' | 'docs' | 'interactive-learning' | 'other';

/** Depth below `/docs/learning-hub/`: 0 is the home, 1 a journey, 2 a section or module, 3 a step. */
export type LearnKind = 'home' | 'journey' | 'section' | 'step';

export interface LearnLocation {
  kind: LearnKind;
  /** Journey URL without a trailing slash; absent for the home. */
  journeyBaseUrl?: string;
  /** Section or module URL without a trailing slash; present for a section and its steps. */
  sectionUrl?: string;
}

export type LegacySegmentName = 'learning-journeys' | 'learning-paths' | 'tutorials';

/** One `learning-journeys`, `learning-paths` or `tutorials` segment of the path, wherever it sits. */
export interface LegacySegment {
  name: LegacySegmentName;
  /** The segment before it is `docs`. */
  underDocs: boolean;
  /** First in the path, or directly after a leading `/docs`. */
  rooted: boolean;
  /** Last in the path, with no slash after it. */
  bare: boolean;
}

/** `exact` when a whole segment is `milestone-N`, `prefix` when a segment only starts with it. */
export type MilestoneSegment = 'exact' | 'prefix';

/** The legacy path segments of a non-Learn URL; absent when it has none. */
export interface LegacyPathFacts {
  segments: readonly LegacySegment[];
  milestone?: MilestoneSegment;
}

export interface DocsUrlClassification {
  family: DocsUrlFamily;
  /**
   * Base URL of a legacy journey, path or tutorial, without a trailing slash.
   * Absent for other families and for anything that is not http(s).
   */
  journeyBaseUrl?: string;
  learn?: LearnLocation;
  legacy?: LegacyPathFacts;
}

const LEARN_ROOT = '/docs/learning-hub/';
const LEARN_SEARCH_SEGMENT = 'search';
const LEARN_MAX_DEPTH = 3;
const UNSTYLED_FILE = 'unstyled.html';
const DOCS_SEGMENT = 'docs';

const LEARN_KIND_BY_DEPTH: readonly LearnKind[] = ['home', 'journey', 'section', 'step'];

const LEGACY_FAMILY_BY_SEGMENT: Record<LegacySegmentName, DocsUrlFamily> = {
  'learning-journeys': 'legacy-learning-journey',
  'learning-paths': 'learning-path',
  tutorials: 'tutorial',
};

const MILESTONE_EXACT = /^milestone-\d+$/;
const MILESTONE_PREFIX = /^milestone-\d/;

const LEGACY_JOURNEY_BASE = /^\/docs\/(?:learning-journeys|learning-paths)\/[^/]+|^\/tutorials\/[^/]+/;

const OTHER: DocsUrlClassification = { family: 'other' };

const LEGACY_SEGMENT_NAMES: ReadonlySet<string> = new Set(Object.keys(LEGACY_FAMILY_BY_SEGMENT));

function isLegacySegmentName(segment: string): segment is LegacySegmentName {
  return LEGACY_SEGMENT_NAMES.has(segment);
}

/** The pathname with `unstyled.html` or a `content[.<locale>].json` file removed, keeping the slash before it. */
function stripFile(pathname: string): string {
  if (pathname.endsWith(`/${UNSTYLED_FILE}`)) {
    return pathname.slice(0, -UNSTYLED_FILE.length);
  }
  const stripped = stripContentFile(pathname);
  return stripped === pathname ? pathname : `${stripped}/`;
}

function isHttp(url: URL): boolean {
  return url.protocol === 'https:' || url.protocol === 'http:';
}

function legacyPathFacts(path: string): LegacyPathFacts | undefined {
  const parts = path.split('/');
  const absolute = parts[0] === '';
  const segments: LegacySegment[] = [];
  let milestone: MilestoneSegment | undefined;
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i]!;
    if (isLegacySegmentName(part)) {
      segments.push({
        name: part,
        underDocs: i >= 2 && parts[i - 1] === DOCS_SEGMENT,
        rooted: absolute && (i === 1 || (i === 2 && parts[1] === DOCS_SEGMENT)),
        bare: i === parts.length - 1,
      });
    } else if (MILESTONE_EXACT.test(part)) {
      milestone = 'exact';
    } else if (milestone === undefined && MILESTONE_PREFIX.test(part)) {
      milestone = 'prefix';
    }
  }
  if (segments.length === 0 && milestone === undefined) {
    return undefined;
  }
  return { segments, ...(milestone && { milestone }) };
}

/** `undefined` when the URL is outside the Learn tree or off a Grafana docs host. */
function classifyLearn(url: URL, path: string): DocsUrlClassification | undefined {
  const slashed = path.endsWith('/') ? path : `${path}/`;
  if (!slashed.startsWith(LEARN_ROOT) || !isGrafanaDomain(url.href)) {
    return undefined;
  }
  const segments = slashed.slice(LEARN_ROOT.length).split('/').filter(Boolean);
  if (segments[0] === LEARN_SEARCH_SEGMENT) {
    return OTHER;
  }
  if (segments.length > LEARN_MAX_DEPTH) {
    return { family: 'docs' };
  }
  const kind = LEARN_KIND_BY_DEPTH[segments.length]!;
  const at = (depth: number) => `${url.origin}${LEARN_ROOT}${segments.slice(0, depth).join('/')}`;
  return {
    family: 'learn',
    learn: {
      kind,
      ...(segments.length >= 1 && { journeyBaseUrl: at(1) }),
      ...(segments.length >= 2 && { sectionUrl: at(2) }),
    },
  };
}

function legacyJourneyBaseUrl(url: URL, path: string): string | undefined {
  if (!isHttp(url)) {
    return undefined;
  }
  const rooted = LEGACY_JOURNEY_BASE.exec(path);
  return rooted ? `${url.origin}${rooted[0]}` : undefined;
}

function rootFamily(legacy: LegacyPathFacts | undefined): DocsUrlFamily | undefined {
  const root = legacy?.segments.find((segment) => segment.rooted && !segment.bare);
  return root && LEGACY_FAMILY_BY_SEGMENT[root.name];
}

/**
 * Classify a docs URL by its parsed pathname. Query strings and fragments never
 * take part, and a URL that does not parse is `other`. Pass a `URL` to skip a
 * second parse.
 */
export function classifyDocsUrl(input: string | URL): DocsUrlClassification {
  const url = typeof input === 'string' ? parseUrlSafely(input) : input;
  if (!url) {
    return OTHER;
  }

  const path = stripFile(url.pathname);
  const learn = classifyLearn(url, path);
  if (learn?.family === 'learn') {
    return learn;
  }

  const legacy = legacyPathFacts(path);
  const withFacts = (classification: DocsUrlClassification): DocsUrlClassification =>
    legacy ? { ...classification, legacy } : classification;
  if (learn) {
    return withFacts(learn);
  }

  const journeyBaseUrl = legacyJourneyBaseUrl(url, path);
  const withBase = (family: DocsUrlFamily): DocsUrlClassification =>
    withFacts({ family, ...(journeyBaseUrl && { journeyBaseUrl }) });

  const family = rootFamily(legacy);
  if (family) {
    return withBase(family);
  }
  if (isInteractiveLearningUrl(url.href)) {
    return withBase('interactive-learning');
  }
  return withBase(isGrafanaDocsUrl(url.href) ? 'docs' : 'other');
}

function hasLegacySegment(classification: DocsUrlClassification, test: (segment: LegacySegment) => boolean): boolean {
  return classification.legacy?.segments.some(test) ?? false;
}

/**
 * Opens as a learning-journey tab and publishes a `content.json`: a
 * `learning-journeys` or `learning-paths` segment followed by more path,
 * anywhere in it. Grafana Learn is deliberately absent until the journey mode
 * lands behind its flag.
 */
export function isLegacyJourneyFamily(classification: DocsUrlClassification): boolean {
  return hasLegacySegment(classification, (segment) => segment.name !== 'tutorials' && !segment.bare);
}

/** The link handler's narrower journey rule: the path starts with `/docs/learning-journeys/` or `/docs/learning-paths/`. */
export function isDocsRootedLegacyJourney(classification: DocsUrlClassification): boolean {
  return hasLegacySegment(
    classification,
    (segment) => segment.name !== 'tutorials' && segment.underDocs && segment.rooted && !segment.bare
  );
}

/**
 * URLs the content fetcher types as `learning-journey`: `/docs/learning-journeys/`,
 * `/docs/learning-paths/` or `/tutorials/` anywhere in the path, or a segment
 * starting with `milestone-N`.
 */
export function isJourneyContent(classification: DocsUrlClassification): boolean {
  return (
    classification.legacy?.milestone !== undefined ||
    hasLegacySegment(classification, (segment) => !segment.bare && (segment.name === 'tutorials' || segment.underDocs))
  );
}

/** Any `learning-journeys`, `learning-paths`, `tutorials` or whole `milestone-N` segment, bare or not. */
export function hasJourneyFamilySegment(classification: DocsUrlClassification): boolean {
  const legacy = classification.legacy;
  return legacy !== undefined && (legacy.segments.length > 0 || legacy.milestone === 'exact');
}
