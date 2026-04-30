/**
 * CLI-only semantic validators.
 *
 * The block and manifest Zod schemas (`src/types/json-guide.schema.ts`,
 * `src/types/package.schema.ts`) intentionally stay loose so existing content
 * keeps loading. The validators here add stricter, authoring-time checks that
 * run inside the CLI commands before `mutateAndValidate` writes anything.
 *
 * The asymmetry is deliberate: schemas accept what the runtime can parse;
 * the CLI rejects what an agent should not be authoring in the first place
 * (bad URLs, invalid regex, garbage CSS selectors, malformed semver, etc.).
 *
 * Adding a new check is a one-line edit to BLOCK_FIELD_VALIDATORS or
 * MANIFEST_FIELD_VALIDATORS.
 */

import { PACKAGE_ID_REGEX } from '../../types/package.schema';
import { SEMVER_PATTERN } from '../../validation/condition-validator';

/**
 * Error thrown by an assert function. Carries the field path and the reason
 * separately so callers can render `<path>: <reason>` consistently.
 */
export class CliValidationError extends Error {
  constructor(
    readonly fieldPath: string,
    readonly reason: string
  ) {
    super(`${fieldPath}: ${reason}`);
    this.name = 'CliValidationError';
  }
}

function fail(fieldPath: string, reason: string): never {
  throw new CliValidationError(fieldPath, reason);
}

// ---------------------------------------------------------------------------
// Individual asserts
// ---------------------------------------------------------------------------

export function assertSafeUrl(value: unknown, fieldPath: string): void {
  if (typeof value !== 'string') {
    fail(fieldPath, 'must be a string URL');
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    fail(fieldPath, `not a valid URL: "${value}"`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    fail(fieldPath, `URL must use http or https protocol (got "${parsed.protocol}")`);
  }
}

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);

/**
 * Video `src` must be an embeddable URL — Pathfinder renders video blocks in
 * an `<iframe>` and YouTube's standard `/watch?v=...` page refuses to be
 * iframed. Catching this at authoring time (instead of at runtime when the
 * iframe silently fails) is the difference between a clear error and a
 * mystery blank panel for the learner.
 *
 * Caught shapes (all rewritten to `https://www.youtube.com/embed/<id>`):
 *   - https://www.youtube.com/watch?v=ID
 *   - https://youtube.com/watch?v=ID
 *   - https://m.youtube.com/watch?v=ID
 *   - https://youtu.be/ID  (the share-link short form)
 *
 * Anything else passes through `assertSafeUrl` and is left alone — Vimeo,
 * Loom, self-hosted MP4s, etc. all embed without rewriting.
 */
export function assertEmbeddableVideoUrl(value: unknown, fieldPath: string): void {
  assertSafeUrl(value, fieldPath);
  // assertSafeUrl narrows to string for us, but TS doesn't see through `fail`.
  const url = new URL(value as string);

  if (YOUTUBE_HOSTS.has(url.hostname) && url.pathname === '/watch') {
    const id = url.searchParams.get('v');
    const suggestion = id ? `https://www.youtube.com/embed/${id}` : 'https://www.youtube.com/embed/<VIDEO_ID>';
    fail(
      fieldPath,
      `YouTube watch URL is not embeddable in an iframe — use the embed URL instead. ` +
        `Replace "${value as string}" with "${suggestion}".`
    );
  }

  if (url.hostname === 'youtu.be') {
    const id = url.pathname.replace(/^\//, '').split('/')[0] ?? '';
    const suggestion = id ? `https://www.youtube.com/embed/${id}` : 'https://www.youtube.com/embed/<VIDEO_ID>';
    fail(
      fieldPath,
      `youtu.be share URLs are not embeddable in an iframe — use the embed URL instead. ` +
        `Replace "${value as string}" with "${suggestion}".`
    );
  }
}

export function assertSemver(value: unknown, fieldPath: string): void {
  if (typeof value !== 'string') {
    fail(fieldPath, 'must be a semver string');
  }
  if (!SEMVER_PATTERN.test(value)) {
    fail(fieldPath, `must be semver in major.minor.patch form (got "${value}")`);
  }
}

export function assertValidRegex(value: unknown, fieldPath: string): void {
  if (typeof value !== 'string') {
    fail(fieldPath, 'must be a regex source string');
  }
  try {
    new RegExp(value);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    fail(fieldPath, `not a valid regular expression: ${detail}`);
  }
}

/**
 * Heuristic CSS selector validator. Not a parser — we only refuse the
 * obvious-garbage shapes that LLM-authored content tends to produce when the
 * agent is confused (e.g. `<<<not a selector>>>`). Real selector parsing
 * would need css-what / postcss-selector-parser; that's out of scope for the
 * authoring CLI today.
 */
export function assertCssSelector(value: unknown, fieldPath: string): void {
  if (typeof value !== 'string') {
    fail(fieldPath, 'must be a CSS selector string');
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    fail(fieldPath, 'CSS selector must not be empty');
  }
  // Reject `<` to catch HTML-fragment-as-selector mistakes (`<div>`,
  // `<<<x>>>`). `>` is the standard CSS child combinator (`nav > ul > li`)
  // and must be allowed.
  if (/</.test(trimmed)) {
    fail(fieldPath, `CSS selector must not contain "<" characters: "${value}"`);
  }
}

export function assertPackageIdRef(value: unknown, fieldPath: string): void {
  if (typeof value !== 'string') {
    fail(fieldPath, 'must be a package id string');
  }
  if (value.length === 0) {
    fail(fieldPath, 'package id must not be empty');
  }
  if (!PACKAGE_ID_REGEX.test(value)) {
    fail(
      fieldPath,
      `package id must be kebab-case (lowercase alphanumeric and hyphens, no leading/trailing hyphen): "${value}"`
    );
  }
}

export function assertNonNegativeInt(value: unknown, fieldPath: string): void {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    fail(fieldPath, 'must be an integer');
  }
  if (value < 0) {
    fail(fieldPath, `must be >= 0 (got ${value})`);
  }
}

export function assertPositiveInt(value: unknown, fieldPath: string): void {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    fail(fieldPath, 'must be an integer');
  }
  if (value < 1) {
    fail(fieldPath, `must be >= 1 (got ${value})`);
  }
}

export function assertNonEmptyString(value: unknown, fieldPath: string): void {
  if (typeof value !== 'string') {
    fail(fieldPath, 'must be a string');
  }
  if (value.trim().length === 0) {
    fail(fieldPath, 'must not be empty');
  }
}

const KNOWN_REPOSITORIES = new Set(['bundled', 'interactive-tutorials']);

/**
 * Repository ref accepts a known literal name OR an http(s) URL — matches the
 * shapes used in bundled-interactives content today.
 */
export function assertRepositoryRef(value: unknown, fieldPath: string): void {
  if (typeof value !== 'string') {
    fail(fieldPath, 'must be a string');
  }
  if (KNOWN_REPOSITORIES.has(value)) {
    return;
  }
  // Otherwise must be a URL.
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      fail(fieldPath, `repository must be a known name or http(s) URL (got "${value}")`);
    }
  } catch {
    fail(
      fieldPath,
      `repository must be one of [${[...KNOWN_REPOSITORIES].join(', ')}] or an http(s) URL (got "${value}")`
    );
  }
}

// ---------------------------------------------------------------------------
// Registry: which fields get which validators
// ---------------------------------------------------------------------------

export type FieldValidator = (value: unknown, fieldPath: string) => void;

function arrayOf(elementAssert: FieldValidator): FieldValidator {
  return (value, fieldPath) => {
    if (!Array.isArray(value)) {
      fail(fieldPath, 'must be an array');
    }
    value.forEach((element, index) => elementAssert(element, `${fieldPath}[${index}]`));
  };
}

/**
 * Per-block-type, per-field-name registry. Keys match the camelCase property
 * names used in the Zod block schemas (so they line up with what
 * `parseOptionValues` projects from Commander flag values).
 */
export const BLOCK_FIELD_VALIDATORS: Record<string, Record<string, FieldValidator[]>> = {
  image: {
    src: [assertSafeUrl],
    width: [assertNonNegativeInt],
    height: [assertNonNegativeInt],
  },
  video: {
    src: [assertEmbeddableVideoUrl],
    start: [assertNonNegativeInt],
    end: [assertNonNegativeInt],
  },
  interactive: {
    reftarget: [assertCssSelector],
    verify: [assertCssSelector],
    scrollContainer: [assertCssSelector],
  },
  input: {
    pattern: [assertValidRegex],
  },
  quiz: {
    maxAttempts: [assertPositiveInt],
  },
  guided: {
    stepTimeout: [assertPositiveInt],
  },
};

export const STEP_FIELD_VALIDATORS: Record<string, FieldValidator[]> = {
  reftarget: [assertCssSelector],
  scrollContainer: [assertCssSelector],
};

export const CHOICE_FIELD_VALIDATORS: Record<string, FieldValidator[]> = {
  text: [assertNonEmptyString],
};

export const MANIFEST_FIELD_VALIDATORS: Record<string, FieldValidator[]> = {
  repository: [assertRepositoryRef],
  schemaVersion: [assertSemver],
  description: [assertNonEmptyString],
  depends: [arrayOf(assertPackageIdRef)],
  recommends: [arrayOf(assertPackageIdRef)],
  suggests: [arrayOf(assertPackageIdRef)],
  provides: [arrayOf(assertPackageIdRef)],
  conflicts: [arrayOf(assertPackageIdRef)],
  replaces: [arrayOf(assertPackageIdRef)],
};

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

function runValidators(fieldName: string, validators: FieldValidator[], value: unknown, pathPrefix: string): void {
  for (const validator of validators) {
    validator(value, `${pathPrefix}.${fieldName}`);
  }
}

/**
 * Run CLI-strict validators against the user-supplied flag values for a
 * given block type. Skips fields the user didn't supply (registry only fires
 * when a key is present in `values`).
 */
export function assertCliBlockFields(blockType: string, values: Record<string, unknown>): void {
  const map = BLOCK_FIELD_VALIDATORS[blockType];
  if (!map) {
    return;
  }
  for (const [fieldName, validators] of Object.entries(map)) {
    if (!Object.prototype.hasOwnProperty.call(values, fieldName)) {
      continue;
    }
    runValidators(fieldName, validators, values[fieldName], blockType);
  }
}

/** Same as `assertCliBlockFields` but for step values. */
export function assertCliStepFields(values: Record<string, unknown>): void {
  for (const [fieldName, validators] of Object.entries(STEP_FIELD_VALIDATORS)) {
    if (!Object.prototype.hasOwnProperty.call(values, fieldName)) {
      continue;
    }
    runValidators(fieldName, validators, values[fieldName], 'step');
  }
}

/** Same as `assertCliBlockFields` but for quiz choices. */
export function assertCliChoiceFields(values: Record<string, unknown>): void {
  for (const [fieldName, validators] of Object.entries(CHOICE_FIELD_VALIDATORS)) {
    if (!Object.prototype.hasOwnProperty.call(values, fieldName)) {
      continue;
    }
    runValidators(fieldName, validators, values[fieldName], 'choice');
  }
}

/**
 * Run CLI-strict validators against a manifest patch (the partial object built
 * from `set-manifest --foo` flags). Only the keys present in `values` are
 * checked, matching the partial-patch semantics of `set-manifest`.
 */
export function assertCliManifestFields(values: Record<string, unknown>): void {
  for (const [fieldName, validators] of Object.entries(MANIFEST_FIELD_VALIDATORS)) {
    if (!Object.prototype.hasOwnProperty.call(values, fieldName)) {
      continue;
    }
    runValidators(fieldName, validators, values[fieldName], 'manifest');
  }
}
