/**
 * Shared "exactly one of {artifact} | {sessionToken}" resolver for the
 * read-only / read-then-load tool surface (P7).
 *
 * Used by `inspection-tools.ts` (inspect / validate) and by `finalize.ts`.
 * Mutation tools use a parallel resolver in `mutation-tools.ts` that also
 * threads `expectedGeneration` and the post-mutation writeback — the
 * read-side shape is simpler and worth factoring out so the two callers
 * stay in lockstep on error wire shapes.
 */

import type { ContentJson, ManifestJson } from '../../../types/package.types';
import { enforceMcpSessionPin } from '../lib/session-pin';
import { normalizeSessionToken } from '../lib/session-token';
import { SessionStoreUnavailableError, type SessionStore } from '../lib/session-store';
import {
  inputModeAmbiguousResult,
  inputModeMissingResult,
  invalidSessionTokenResult,
  sessionNotFoundResult,
  storeUnavailableResult,
} from './result';
import { storeUnavailable } from './state-bridge';

export type ReadInputResolution =
  | {
      ok: true;
      content: ContentJson;
      manifest: ManifestJson | undefined;
      manifestAuthored: boolean;
      /**
       * Present in session-mode only. Callers that need to delete or
       * reference the session after the read (e.g. finalize) use this.
       */
      sessionToken: string | undefined;
    }
  | {
      ok: false;
      response: { content: Array<{ type: 'text'; text: string }>; isError?: boolean };
    };

export async function resolveReadOnlyInput(
  store: SessionStore,
  inputs: {
    artifact?: { content: Record<string, unknown>; manifest?: Record<string, unknown> };
    sessionToken?: string;
  },
  mcpSessionId?: string
): Promise<ReadInputResolution> {
  const hasArtifact = inputs.artifact !== undefined;
  const hasToken = typeof inputs.sessionToken === 'string' && inputs.sessionToken.length > 0;
  if (hasArtifact && hasToken) {
    return { ok: false, response: inputModeAmbiguousResult() };
  }
  if (!hasArtifact && !hasToken) {
    return { ok: false, response: inputModeMissingResult() };
  }
  if (hasToken) {
    const token = normalizeSessionToken(inputs.sessionToken);
    if (!token) {
      return { ok: false, response: invalidSessionTokenResult() };
    }
    try {
      const pinFailure = await enforceMcpSessionPin({ store, mcpSessionId }, token);
      if (pinFailure) {
        return { ok: false, response: pinFailure };
      }
      const loaded = await store.load(token);
      if (loaded === null) {
        return { ok: false, response: sessionNotFoundResult(token) };
      }
      return {
        ok: true,
        content: loaded.artifact.content,
        manifest: loaded.artifact.manifest,
        manifestAuthored: loaded.artifact.manifest !== undefined,
        sessionToken: token,
      };
    } catch (err) {
      if (err instanceof SessionStoreUnavailableError) {
        return { ok: false, response: storeUnavailableResult(token, storeUnavailable(err)) };
      }
      throw err;
    }
  }
  const a = inputs.artifact!;
  return {
    ok: true,
    content: a.content as unknown as ContentJson,
    manifest: a.manifest as unknown as ManifestJson | undefined,
    manifestAuthored: a.manifest !== undefined,
    sessionToken: undefined,
  };
}
