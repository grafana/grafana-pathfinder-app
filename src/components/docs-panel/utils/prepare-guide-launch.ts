/**
 * One-shot launch preparation: fetch a guide's content once, expand its snippet
 * refs, and classify whether it drives the Grafana UI — all BEFORE a display
 * surface is committed. The result carries the resolved content so the
 * destination renders it without a second fetch.
 *
 * The classification runs on the snippet-EXPANDED guide (so actions hidden
 * inside snippets count) and fails safe: a snippet that could not be resolved
 * forces `requiresGrafanaUi: true` so an action is never hidden behind a
 * placeholder.
 *
 * `preparedContent` re-serializes the expanded guide back into the fetched
 * `RawContent`, so the renderer takes its synchronous parse path and issues no
 * post-mount snippet requests. It is one-shot memory state — carried through a
 * launch handoff and consumed once, never persisted to tab storage.
 *
 * Fetched content is guide-SHAPED but not guaranteed valid: `wrapContentAsJsonGuide`
 * admits already-JSON content on a shallow `id && title && Array.isArray(blocks)`
 * check, so nesting can be malformed. Both the expansion and the classification
 * walk nested `blocks`/`steps` and throw on a missing one, so the guide is
 * validated first — through the same `validateGuide` gate `parseJsonGuide`
 * applies, so nothing that renders today is rejected here. Both failure branches
 * log because the fetch ladder's telemetry already recorded a success.
 */

import { fetchPackageInfoFromUrl, isPackageContentUrl } from '../../../docs-retrieval';
import { logger } from '../../../lib/logging';
import { normalizeTelemetryUrl } from '../../../lib/telemetry';
import { inlineSnippetRefsInGuideWithStatus } from '../../../snippet-engine';
import type { LaunchSource } from '../../../recovery';
import type { PackageOpenInfo } from '../../../types/content-panel.types';
import type { RawContent } from '../../../types/content.types';
import type { JsonGuide } from '../../../types/json-guide.types';
import { validateGuide } from '../../../validation';

import { loadDocsTabContentResult } from './docs-tab-loader';
import { requiresGrafanaUi } from './requires-grafana-ui';
import { isLearningJourneyUrl } from './url-validation';

/**
 * An in-memory, consume-once launch payload. Carries the resolved content plus
 * the surface decision so the destination tab opens without re-fetching.
 */
export interface PreparedGuideLaunch {
  url: string;
  title: string;
  /** Routing discriminator — `isLearningJourneyUrl`, shared with the auto-open listener. */
  type: 'learning-journey' | 'docs';
  source: LaunchSource;
  /** Snippet-expanded content, ready for the renderer's synchronous parse path. */
  preparedContent: RawContent;
  /** True when any reachable step drives the live Grafana UI (or a snippet failed to resolve). */
  requiresGrafanaUi: boolean;
  /** Preserved so journey/package rendering (milestone toolbar) survives the handoff. */
  packageInfo?: PackageOpenInfo;
}

/**
 * Stable, low-cardinality failure classification. `error` is free text that can
 * carry fetched-guide values (the fetch tier forwards Zod messages), so
 * telemetry reports this code and never the message.
 */
export type PrepareGuideLaunchErrorCode = 'fetch-failed' | 'unparseable' | 'schema-invalid';

export type PrepareGuideLaunchResult =
  | { ok: true; launch: PreparedGuideLaunch }
  | { ok: false; error: string; errorCode: PrepareGuideLaunchErrorCode };

interface PrepareGuideLaunchContext {
  title: string;
  source: LaunchSource;
  /** Pre-resolved package context (recommender path); otherwise derived from the URL. */
  packageInfo?: PackageOpenInfo;
}

/**
 * Fetch, expand, and classify a guide for launch. Returns a failure result
 * (leaving the caller's origin visible) when the fetch fails — the caller must
 * NOT commit a surface and re-fetch in that case.
 */
export async function prepareGuideLaunch(
  url: string,
  context: PrepareGuideLaunchContext
): Promise<PrepareGuideLaunchResult> {
  // Mirror loadDocsTabContent's package derivation so the single fetch here is
  // identical to the one the destination loader would otherwise perform.
  let packageInfo = context.packageInfo;
  if (!packageInfo && isPackageContentUrl(url)) {
    packageInfo = await fetchPackageInfoFromUrl(url);
  }

  const result = await loadDocsTabContentResult(url, { packageInfo });
  if (!result.content) {
    return { ok: false, error: result.error || 'Failed to load content', errorCode: 'fetch-failed' };
  }

  const rawContent = result.content;

  let guide: JsonGuide;
  try {
    guide = JSON.parse(rawContent.content) as JsonGuide;
  } catch {
    logger.error('[PrepareGuideLaunch] Guide content could not be parsed', {
      content_url: normalizeTelemetryUrl(url),
    });
    return { ok: false, error: 'Guide content could not be parsed', errorCode: 'unparseable' };
  }

  const validation = validateGuide(guide);
  if (!validation.isValid) {
    logger.error('[PrepareGuideLaunch] Guide content failed schema validation', {
      content_url: normalizeTelemetryUrl(url),
      validation_error_count: validation.errors.length,
      validation_error_codes: [...new Set(validation.errors.map((error) => error.code))].sort(),
    });
    return { ok: false, error: 'Guide content failed schema validation', errorCode: 'schema-invalid' };
  }

  // Expand the parsed guide, never `validation.guide`: only the root schema is
  // loose, so the validated copy has dropped unknown fields nested in blocks.
  const { guide: expandedGuide, unresolvedSnippetIds } = await inlineSnippetRefsInGuideWithStatus(guide);
  const needsGrafanaUi = requiresGrafanaUi(expandedGuide) || unresolvedSnippetIds.length > 0;

  const preparedContent: RawContent = { ...rawContent, content: JSON.stringify(expandedGuide) };

  return {
    ok: true,
    launch: {
      url,
      title: context.title,
      type: isLearningJourneyUrl(url) ? 'learning-journey' : 'docs',
      source: context.source,
      preparedContent,
      requiresGrafanaUi: needsGrafanaUi,
      packageInfo,
    },
  };
}
