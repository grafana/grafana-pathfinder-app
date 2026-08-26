/**
 * A Zod field as a Commander `Option`.
 *
 * The half of the old `schema-options` that only a command line wants: flag spelling,
 * placeholders, shorts, the appender that makes a parameter repeatable, and the numeric
 * pre-parse Commander performs before any schema sees the value. It lives with the other
 * Commander code so that reading a field's shape — which both surfaces do — does not
 * drag a parser dependency along with it.
 *
 * What a field *is* stays in `utils/schema-options`. Nothing here decides that.
 */

import { InvalidArgumentError, Option } from 'commander';
import type { z } from 'zod';

import { describeField, fieldHelpText, fieldNameToFlag, type UnionBranchKind } from '../utils/schema-options';
import { numberConstraints } from '../utils/zod-internals';

/**
 * Build a Commander `Option` for one Zod field, or `null` when the field has no
 * flag spelling — a literal, a nested object, a union of non-primitives.
 *
 * `name` is the schema's camelCase property name; the flag is kebab-cased.
 */
export function buildOptionForField(
  name: string,
  field: z.ZodType,
  presentation: { placeholder?: string; short?: string; description?: string } = {}
): Option | null {
  const shape = describeField(field);
  const flag = fieldNameToFlag(name);
  // Text-help only: `-o, --output <file>` reads better than `--output <string>`, and
  // neither parsing nor the agent surface sees either part.
  const placeholder = presentation.placeholder;
  const lead = presentation.short ? `-${presentation.short}, --${flag}` : `--${flag}`;

  if (shape.kind === 'literal' || shape.kind === 'unsupported') {
    return null;
  }

  // The caller's rendering when it has one — the Commander adapter passes what
  // `CLI_VIEW` says — falling back to the schema's own wording.
  const description = presentation.description ?? fieldHelpText(name, field);

  if (shape.kind === 'boolean') {
    const option = new Option(lead, description);
    if (!shape.optional) {
      option.makeOptionMandatory();
    }
    return option;
  }

  if (shape.kind === 'enum') {
    const option = new Option(`${lead} <${placeholder ?? shape.values.join('|')}>`, description);
    if (shape.values.length > 0) {
      option.choices(shape.values);
    }
    if (!shape.optional) {
      option.makeOptionMandatory();
    }
    return option;
  }

  if (shape.kind === 'array-string' || shape.kind === 'array-enum') {
    const token = shape.kind === 'array-enum' ? shape.values.join('|') : 'item';
    // Repeatable: each --flag <item> appends to the accumulated array.
    const option = new Option(`${lead} <${placeholder ?? token}>`, description);
    if (shape.kind === 'array-enum' && shape.values.length > 0) {
      // Before `argParser`, deliberately: `choices()` installs a `parseArg` of
      // its own that replaces rather than appends, so registering the appender
      // afterwards is what keeps the parameter repeatable. Membership is then
      // enforced by the schema on both entrypoints instead of by Commander on
      // one, and `choices()` remains only as the help-text listing.
      option.choices(shape.values);
    }
    // No seed default: the appender starts the list itself, so an absent flag stays
    // absent rather than arriving as a Commander-supplied `[]`. Whether help prints a
    // declared default is `render-commander`'s to decide, not this builder's.
    option.argParser((value: string, previous: string[] | undefined) => [...(previous ?? []), value]);
    if (!shape.optional) {
      option.makeOptionMandatory();
    }
    return option;
  }

  if (shape.kind === 'union') {
    // A command line only ever hands the schema a string — there is no second
    // channel for "this token is a boolean". Coercing here, before the schema
    // sees the value, is what makes `--default-value true` reach `z.union([z.string(),
    // z.boolean()])` as the boolean `true` rather than the string `"true"`; the
    // schema still has the last word; a branch this coercion cannot produce
    // (a defaulted `true`/`false` typo, an out-of-range number) is a plain
    // string by the time it gets there and fails whichever branch was meant.
    const token = shape.branches.join('-or-');
    const option = new Option(`${lead} <${placeholder ?? token}>`, description);
    option.argParser((value: string) => coerceUnionValue(value, shape.branches));
    if (!shape.optional) {
      option.makeOptionMandatory();
    }
    return option;
  }

  if (shape.kind === 'number') {
    const option = new Option(`${lead} <${placeholder ?? 'number'}>`, description);
    const accepts = numberNoun(field);
    option.argParser((value: string) => {
      const n = Number(value);
      if (Number.isNaN(n)) {
        throw new InvalidArgumentError(`--${flag} must be ${accepts}, got "${value}"`);
      }
      return n;
    });
    if (!shape.optional) {
      option.makeOptionMandatory();
    }
    return option;
  }

  // string
  const option = new Option(`${lead} <${placeholder ?? 'string'}>`, description);
  if (!shape.optional) {
    option.makeOptionMandatory();
  }
  return option;
}

/**
 * Coerce one command-line token into whichever union branch it looks like.
 *
 * Boolean and number are tried first — `"true"` and `"42"` are unambiguous
 * spellings of those types and a caller who typed them almost never meant the
 * literal string — and only a branch the field actually declares is tried, so
 * `z.union([z.string(), z.number()])` never produces a boolean and vice
 * versa. Anything left over stays a string, which `z.union`'s own `safeParse`
 * then accepts or rejects on its own terms.
 */
function coerceUnionValue(value: string, branches: readonly UnionBranchKind[]): string | number | boolean {
  if (branches.includes('boolean') && (value === 'true' || value === 'false')) {
    return value === 'true';
  }
  if (branches.includes('number') && value.trim() !== '' && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return value;
}

/**
 * What a numeric parameter accepts, as a noun a message can end with.
 *
 * A value that is not a number at all fails here, before any schema check runs, so this
 * message has to state the constraint itself. Reading it off the field keeps the two
 * from disagreeing: `--position` says "a non-negative integer" because the schema says
 * `.int().nonnegative()`, not because a hand-written parser said so.
 */
function numberNoun(field: z.ZodType): string {
  const { integer, min } = numberConstraints(field);
  const unit = integer ? 'integer' : 'number';
  if (min !== undefined && min === 0) {
    return `a non-negative ${unit}`;
  }
  if (min !== undefined && min > 0) {
    return `a positive ${unit}`;
  }
  return integer ? 'an integer' : 'a number';
}
