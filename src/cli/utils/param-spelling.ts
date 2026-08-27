/**
 * Parameter references in prose, spelled by whoever is reading.
 *
 * A description or an error message often has to name another parameter — "use at
 * most one of before/after/position", "only valid when parent is a conditional". The
 * name is a fact; how it is written is not: an operator types `--before`, an agent
 * sends `before`. Writing either one into a schema or a runner picks a reader, which
 * is how `--flag` spellings ended up in the agent surface.
 *
 * So prose carries `{@before}`, and each surface spells it: the Commander adapter with
 * its own flag rendering, the MCP binding with the published parameter name. The
 * substitution is idempotent — nothing spelled contains a reference — so a message may
 * pass a boundary that spells it and another that only checks.
 *
 * The `@` is what makes a reference distinguishable from a brace that happens to be in
 * the text: help strings carry JSON fragments (`Append { urlPrefix: <value> }`) and
 * messages echo values a caller supplied (`{targetAnd} must be valid JSON: {"a":1}`),
 * and neither may be rewritten.
 */

import type { CommandOutcome } from './output';

const PARAM_REFERENCE = /\{@([a-zA-Z][a-zA-Z0-9_]*)\}/g;

/** How a reader writes a parameter's name. */
export type ParamSpelling = (name: string) => string;

/**
 * camelCase → kebab-case for CLI flag names.
 *
 * `showMe` → `show-me`, `validateInput` → `validate-input`.
 * Already-lowercase names like `reftarget` pass through unchanged.
 */
export function fieldNameToFlag(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/** How a command line writes one, absent knowledge of which parameters are positional. */
export const CLI_SPELLING: ParamSpelling = (name) => `--${fieldNameToFlag(name)}`;

export function spellParams(text: string, spell: ParamSpelling): string {
  return text.replace(PARAM_REFERENCE, (_match, name: string) => spell(name));
}

/**
 * A schema failure states each problem twice — in the message a person reads and in the
 * `issues` list a program reads — so both are prose and both get spelled. Any other
 * `data` is left exactly as the runner built it.
 */
function spellIssueList(data: Record<string, unknown>, spell: ParamSpelling): Record<string, unknown> {
  const issues = data.issues;
  if (!Array.isArray(issues)) {
    return data;
  }
  return {
    ...data,
    issues: issues.map((issue) =>
      issue && typeof issue === 'object' && typeof (issue as { message?: unknown }).message === 'string'
        ? { ...issue, message: spellParams((issue as { message: string }).message, spell) }
        : issue
    ),
  };
}

/** Every reader-facing string on an outcome, spelled for one reader. */
export function spellOutcome(outcome: CommandOutcome, spell: ParamSpelling): CommandOutcome {
  if (outcome.status === 'error') {
    return {
      ...outcome,
      message: spellParams(outcome.message, spell),
      ...(outcome.data ? { data: spellIssueList(outcome.data, spell) } : {}),
    };
  }
  return {
    ...outcome,
    summary: spellParams(outcome.summary, spell),
    ...(outcome.text ? { text: spellParams(outcome.text, spell) } : {}),
    ...(outcome.hints ? { hints: outcome.hints.map((hint) => spellParams(hint, spell)) } : {}),
    ...(outcome.warnings
      ? { warnings: outcome.warnings.map((w) => ({ ...w, message: spellParams(w.message, spell) })) }
      : {}),
  };
}
