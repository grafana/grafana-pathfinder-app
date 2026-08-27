/**
 * Shared "exactly one of {artifact} | {sessionToken}" resolver for
 * read-only tools (inspect, validate, finalize).
 *
 * Mutation tools use a parallel path in `mutation-tools.ts` that also
 * threads `expectedGeneration` and post-mutation writeback.
 */

import type { ContentJson, ManifestJson } from '../../../types/package.types';
import { enforceMcpSessionPin } from '../lib/session-pin';
import { normalizeSessionToken } from '../lib/session-token';
import { type AuthoringSessionStore } from '../lib/session-store';
import { invalidSessionTokenResult, sessionNotFoundResult, type ToolResult } from './result';
import { classifyTwoModeInput } from './two-mode-input';

export type ReadInputResolution =
  | {
      ok: true;
      content: ContentJson;
      manifest: ManifestJson | undefined;
      manifestAuthored: boolean;
      /**
       * Present in session-mode only. Surfaced for callers that need to
       * delete or reference the session after the read — finalize becomes
       * the first such caller in the next stack layer.
       */
      sessionToken: string | undefined;
    }
  | {
      ok: false;
      response: ToolResult;
    };

export type TokenResolution = { ok: true; token: string } | { ok: false; response: ToolResult };

/**
 * Normalize a raw token string, then enforce the optional Mcp-Session-Id
 * pin. Returns the canonical (lowercased) token, or a wire-shape error
 * response when the token is invalid or the pin check fails.
 *
 * Shared by every session-mode entry point (read-input.ts's read-only
 * resolver, session-read-tools.ts's fine-grained read tools) so the two
 * stay in lockstep on validation order and error shapes.
 */
export async function resolveAndPinToken(
  store: AuthoringSessionStore,
  rawToken: unknown,
  mcpSessionId: string | undefined
): Promise<TokenResolution> {
  const token = normalizeSessionToken(rawToken);
  if (!token) {
    return { ok: false, response: invalidSessionTokenResult() };
  }
  const pinFailure = await enforceMcpSessionPin({ store, mcpSessionId }, token);
  if (pinFailure) {
    return { ok: false, response: pinFailure };
  }
  return { ok: true, token };
}

export async function resolveReadOnlyInput(
  store: AuthoringSessionStore,
  inputs: {
    artifact?: { content: Record<string, unknown>; manifest?: Record<string, unknown> };
    sessionToken?: string;
  },
  mcpSessionId?: string
): Promise<ReadInputResolution> {
  const classified = classifyTwoModeInput({ artifact: inputs.artifact, sessionToken: inputs.sessionToken });
  if (classified.kind === 'error') {
    return { ok: false, response: classified.response };
  }
  if (classified.kind === 'session') {
    const resolution = await resolveAndPinToken(store, classified.token, mcpSessionId);
    if (!resolution.ok) {
      return { ok: false, response: resolution.response };
    }
    const { token } = resolution;
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
  }
  const a = classified.artifact;
  return {
    ok: true,
    content: a.content as unknown as ContentJson,
    manifest: a.manifest as unknown as ManifestJson | undefined,
    manifestAuthored: a.manifest !== undefined,
    sessionToken: undefined,
  };
}
