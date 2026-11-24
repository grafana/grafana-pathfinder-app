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

export interface DocsUrlClassification {
  family: DocsUrlFamily;
  /**
   * Base URL of a legacy journey, path or tutorial, without a trailing slash.
   * Absent for other families and for anything that is not http(s).
   */
  journeyBaseUrl?: string;
  learn?: LearnLocation;
}

const LEARN_ROOT = '/docs/learning-hub/';
const LEARN_SEARCH_SEGMENT = 'search';
const LEARN_MAX_DEPTH = 3;
const UNSTYLED_FILE = 'unstyled.html';

const LEARN_KIND_BY_DEPTH: readonly LearnKind[] = ['home', 'journey', 'section', 'step'];

// A legacy family is a root of the path: `/docs/learning-paths/…`, `/tutorials/…`. The `/docs` prefix is optional,
// as it has always been for these URLs. A segment deeper in the path (`/docs/alloy/latest/tutorials/…`) is an
// ordinary docs page.
const LEGACY_ROOT = /^(?:\/docs)?\/(learning-journeys|learning-paths|tutorials)\//;
const LEGACY_FAMILY_BY_ROOT: Record<string, DocsUrlFamily> = {
  'learning-journeys': 'legacy-learning-journey',
  'learning-paths': 'learning-path',
  tutorials: 'tutorial',
};

const LEGACY_JOURNEY_BASE = /^\/docs\/(?:learning-journeys|learning-paths)\/[^/]+|^\/tutorials\/[^/]+/;

const OTHER: DocsUrlClassification = { family: 'other' };

/** The pathname with `unstyled.html` or a `content[.<locale>].json` file removed. */
function stripFile(pathname: string): string {
  return pathname.endsWith(`/${UNSTYLED_FILE}`) ? pathname.slice(0, -UNSTYLED_FILE.length) : stripContentFile(pathname);
}

function isHttp(url: URL): boolean {
  return url.protocol === 'https:' || url.protocol === 'http:';
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

function pathFamily(path: string): DocsUrlFamily | undefined {
  const root = LEGACY_ROOT.exec(path)?.[1];
  return root === undefined ? undefined : LEGACY_FAMILY_BY_ROOT[root];
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
  if (learn) {
    return learn;
  }

  const journeyBaseUrl = legacyJourneyBaseUrl(url, path);
  const withBase = (family: DocsUrlFamily): DocsUrlClassification => ({
    family,
    ...(journeyBaseUrl && { journeyBaseUrl }),
  });

  const family = pathFamily(path);
  if (family) {
    return withBase(family);
  }
  if (isInteractiveLearningUrl(url.href)) {
    return withBase('interactive-learning');
  }
  return withBase(isGrafanaDocsUrl(url.href) ? 'docs' : 'other');
}

/**
 * Legacy learning paths and journeys: served as a list of milestones, open as a
 * learning-journey tab, and publish a `content.json` beside the page. Grafana
 * Learn is deliberately absent until the journey mode lands behind its flag.
 */
export function isLegacyJourneyFamily(classification: DocsUrlClassification): boolean {
  return classification.family === 'learning-path' || classification.family === 'legacy-learning-journey';
}

/** URLs the content fetcher types as `learning-journey`: the legacy families and tutorials. */
export function isJourneyContent(classification: DocsUrlClassification): boolean {
  return isLegacyJourneyFamily(classification) || classification.family === 'tutorial';
}
