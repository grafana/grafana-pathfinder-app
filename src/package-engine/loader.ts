/**
 * Package Loader
 *
 * Loads package content (content.json, manifest.json) from bundled sources.
 * Supports both the two-file package model and legacy single-file guides.
 *
 * Transitional duplication note: content loading logic intentionally exists
 * in both docs-retrieval (existing paths) and package-engine (this file).
 * This avoids a lateral coupling between two Tier 2 engines.
 *
 * @coupling Types: package.types.ts, Schemas: package.schema.ts
 */

import { ContentJsonSchema, ManifestJsonObjectSchema } from '../types/package.schema';
import type { ContentJson, ManifestJson, ResolutionError } from '../types/package.types';

export interface LoadSuccess<T> {
  ok: true;
  data: T;
}

export interface LoadFailure {
  ok: false;
  error: ResolutionError;
}

export type LoadOutcome<T> = LoadSuccess<T> | LoadFailure;

function requireBundled(relativePath: string): unknown {
  try {
    return require(`../bundled-interactives/${relativePath}`);
  } catch {
    return undefined;
  }
}

function normalizeJson(raw: unknown): unknown {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

function ensureTrailingSlash(p: string): string {
  return p.endsWith('/') ? p : p + '/';
}

/**
 * Load content.json from a bundled package directory.
 *
 * @param packagePath - Relative path within bundled-interactives (e.g., "first-dashboard/")
 */
export function loadBundledContent(packagePath: string): LoadOutcome<ContentJson> {
  const contentPath = `${ensureTrailingSlash(packagePath)}content.json`;
  const raw = requireBundled(contentPath);

  if (raw === undefined) {
    return {
      ok: false,
      error: { code: 'not-found', message: `Bundled content not found: ${contentPath}` },
    };
  }

  try {
    const data = normalizeJson(raw);
    const result = ContentJsonSchema.safeParse(data);

    if (!result.success) {
      return {
        ok: false,
        error: { code: 'validation-error', message: `Content validation failed: ${result.error.message}` },
      };
    }

    return { ok: true, data: result.data as ContentJson };
  } catch (e) {
    return {
      ok: false,
      error: { code: 'parse-error', message: `Failed to parse content: ${e instanceof Error ? e.message : String(e)}` },
    };
  }
}

/**
 * Load manifest.json from a bundled package directory.
 * Uses ManifestJsonObjectSchema (without the conditional steps refinement)
 * with passthrough to tolerate extension metadata.
 *
 * @param packagePath - Relative path within bundled-interactives (e.g., "first-dashboard/")
 */
export function loadBundledManifest(packagePath: string): LoadOutcome<ManifestJson> {
  const manifestPath = `${ensureTrailingSlash(packagePath)}manifest.json`;
  const raw = requireBundled(manifestPath);

  if (raw === undefined) {
    return {
      ok: false,
      error: { code: 'not-found', message: `Bundled manifest not found: ${manifestPath}` },
    };
  }

  try {
    const data = normalizeJson(raw);
    const result = ManifestJsonObjectSchema.loose().safeParse(data);

    if (!result.success) {
      return {
        ok: false,
        error: { code: 'validation-error', message: `Manifest validation failed: ${result.error.message}` },
      };
    }

    return { ok: true, data: result.data as ManifestJson };
  } catch (e) {
    return {
      ok: false,
      error: {
        code: 'parse-error',
        message: `Failed to parse manifest: ${e instanceof Error ? e.message : String(e)}`,
      },
    };
  }
}

/**
 * Load a legacy single-file guide (pre-package-model format).
 * The file contains both content and minimal metadata in one JSON file.
 * Validates against ContentJsonSchema since the structure is identical.
 *
 * @param filename - Relative path within bundled-interactives (e.g., "old-guide.json")
 */
export function loadBundledLegacyGuide(filename: string): LoadOutcome<ContentJson> {
  const raw = requireBundled(filename);

  if (raw === undefined) {
    return {
      ok: false,
      error: { code: 'not-found', message: `Bundled guide not found: ${filename}` },
    };
  }

  try {
    const data = normalizeJson(raw);
    const result = ContentJsonSchema.safeParse(data);

    if (!result.success) {
      return {
        ok: false,
        error: { code: 'validation-error', message: `Guide validation failed: ${result.error.message}` },
      };
    }

    return { ok: true, data: result.data as ContentJson };
  } catch (e) {
    return {
      ok: false,
      error: { code: 'parse-error', message: `Failed to parse guide: ${e instanceof Error ? e.message : String(e)}` },
    };
  }
}
