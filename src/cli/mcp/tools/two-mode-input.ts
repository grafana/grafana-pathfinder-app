/**
 * Shared schema and runtime-discriminator for the
 * `{artifact} | {sessionToken}` two-mode input contract.
 *
 * Three tool surfaces speak this contract — read-only (inspect / validate),
 * mutation (add_block / edit_block / …), and finalize. Each accepts EITHER
 * `artifact` (stateless, the historical contract) OR `sessionToken` (P7
 * session-mode). This module centralizes the Zod shape and the
 * runtime XOR check so the three surfaces cannot drift on either.
 *
 * Per-tool `.describe()` text is layered on at the call site — the
 * descriptions are LLM-visible and intentionally tool-specific (mutation
 * mentions `__etag` and session-write semantics, finalize mentions
 * session-delete-on-success, inspection mentions the escape-hatch). The
 * shared schema only fixes the shape.
 */

import { z } from 'zod';

import { inputModeAmbiguousResult, inputModeMissingResult } from './result';

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

/** Bare two-mode artifact shape. Used by inspection-tools and finalize. */
export const ArtifactInputBase = z
  .object({
    content: z.record(z.string(), z.unknown()),
    manifest: z.record(z.string(), z.unknown()).optional(),
  })
  .optional();

/**
 * Mutation-side artifact shape — the bare shape plus `__etag` for the
 * integrity check that runs before every mutation. The agent echoes the
 * etag back along with content/manifest; mismatch surfaces as
 * ARTIFACT_MUTATED before the runner ever runs.
 */
export const ArtifactInputWithEtag = z
  .object({
    content: z.record(z.string(), z.unknown()),
    manifest: z.record(z.string(), z.unknown()).optional(),
    __etag: z
      .string()
      .optional()
      .describe(
        'Integrity tag issued on the previous response. Pass back verbatim along with content and manifest; the server verifies it before dispatching.'
      ),
  })
  .optional();

export const SessionTokenBase = z.string().optional();

export const ExpectedGenerationBase = z.number().int().nonnegative().optional();

type ArtifactInput = { content: Record<string, unknown>; manifest?: Record<string, unknown>; __etag?: string };

export type TwoModeClassification =
  | { kind: 'artifact'; artifact: ArtifactInput }
  | { kind: 'session'; token: string }
  | { kind: 'error'; response: ToolResult };

/**
 * Runtime XOR check on the two-mode inputs. Returns a discriminated union
 * — callers branch on `kind` rather than re-running the ambiguous/missing
 * checks inline. The error responses use the existing wire-shape factories
 * (`inputModeAmbiguousResult` / `inputModeMissingResult`) so the wire
 * envelope is byte-identical to the pre-refactor inline checks.
 */
export function classifyTwoModeInput(inputs: {
  artifact?: ArtifactInput;
  sessionToken?: string;
}): TwoModeClassification {
  const hasArtifact = inputs.artifact !== undefined;
  const hasSessionToken = typeof inputs.sessionToken === 'string' && inputs.sessionToken.length > 0;
  if (hasArtifact && hasSessionToken) {
    return { kind: 'error', response: inputModeAmbiguousResult() };
  }
  if (!hasArtifact && !hasSessionToken) {
    return { kind: 'error', response: inputModeMissingResult() };
  }
  if (hasSessionToken) {
    return { kind: 'session', token: inputs.sessionToken! };
  }
  return { kind: 'artifact', artifact: inputs.artifact! };
}
