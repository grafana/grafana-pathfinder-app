import { z } from 'zod';

import { cleanAssistantResponse } from './useAssistantGeneration.hook';

/**
 * The assistant's verdict on a data check.
 *
 * `reason` is displayed as plain text only. Keeping the acted-on part of the
 * response to a two-value enum is what stops a crafted label or log line in the
 * user's own data from steering the outcome.
 */
export const DataCheckVerdictSchema = z.object({
  verdict: z.enum(['pass', 'fail']),
  reason: z.string().max(500),
});

export type DataCheckVerdict = z.infer<typeof DataCheckVerdictSchema>;

/**
 * Parse the assistant's response into a verdict.
 *
 * Fails closed: anything we cannot read as an explicit `pass` leaves the step
 * incomplete, so a malformed or truncated response can never complete a check.
 */
export function parseDataCheckVerdict(
  text: string
): { ok: true; verdict: DataCheckVerdict } | { ok: false; error: Error } {
  const cleaned = cleanAssistantResponse(text);
  let raw: unknown;
  try {
    raw = JSON.parse(cleaned);
  } catch (e) {
    return {
      ok: false,
      error: new Error(`Data check: response was not valid JSON (${e instanceof Error ? e.message : 'parse error'})`),
    };
  }
  const parsed = DataCheckVerdictSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: new Error(`Data check: response failed schema check (${parsed.error.issues[0]?.message ?? 'unknown'})`),
    };
  }
  return { ok: true, verdict: parsed.data };
}
