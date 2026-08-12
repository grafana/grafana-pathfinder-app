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

/** Bodies of fenced code blocks, in order of appearance. */
function extractFencedBlocks(text: string): string[] {
  return Array.from(text.matchAll(/```[a-z]*\s*([\s\S]*?)```/gi))
    .map((match) => match[1]?.trim() ?? '')
    .filter(Boolean);
}

/** Brace-balanced top-level objects, so surrounding prose is ignored. */
function extractBalancedObjects(text: string): string[] {
  const objects: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (depth === 0) {
        start = i;
      }
      depth++;
    } else if (text[i] === '}' && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) {
        objects.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return objects;
}

/**
 * Parse the assistant's response into a verdict.
 *
 * The prompt asks for a bare JSON object, but models routinely wrap it in a
 * sentence of preamble or a code fence, so the verdict is looked for anywhere
 * in the response rather than required to be the whole of it. The last
 * schema-valid object wins: the verdict is the model's closing answer, and
 * anything earlier is preamble that may quote the shape without asserting it.
 *
 * Fails closed: anything we cannot read as an explicit `pass` leaves the step
 * incomplete, so a malformed or truncated response can never complete a check.
 */
export function parseDataCheckVerdict(
  text: string
): { ok: true; verdict: DataCheckVerdict } | { ok: false; error: Error } {
  const candidates = [cleanAssistantResponse(text), ...extractFencedBlocks(text), ...extractBalancedObjects(text)];

  let verdict: DataCheckVerdict | null = null;
  let schemaIssue: string | null = null;
  let sawJson = false;

  for (const candidate of candidates) {
    let raw: unknown;
    try {
      raw = JSON.parse(candidate);
    } catch {
      continue;
    }
    sawJson = true;
    const parsed = DataCheckVerdictSchema.safeParse(raw);
    if (parsed.success) {
      verdict = parsed.data;
    } else {
      schemaIssue = parsed.error.issues[0]?.message ?? 'unknown';
    }
  }

  if (verdict) {
    return { ok: true, verdict };
  }
  if (sawJson) {
    return { ok: false, error: new Error(`Data check: response failed schema check (${schemaIssue ?? 'unknown'})`) };
  }
  return { ok: false, error: new Error('Data check: response contained no verdict JSON') };
}
