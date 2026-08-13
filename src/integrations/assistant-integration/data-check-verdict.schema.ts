import { z } from 'zod';

import { cleanAssistantResponse } from './useAssistantGeneration.hook';

/**
 * `reason` is displayed as plain text only. Keeping the acted-on part to a
 * two-value enum is what stops a crafted label or log line in the user's own
 * data from steering the outcome.
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
 * The last schema-valid object anywhere in the response wins — models wrap the
 * verdict in prose or a fence, and anything earlier may quote the shape without
 * asserting it. Fails closed: only an explicit `pass` can complete a step.
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
