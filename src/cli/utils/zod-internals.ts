/**
 * The one place that reaches into Zod's internals.
 *
 * Zod v4 keeps a schema's structure on `def` — the wrapper kind, the type it wraps, the
 * value a `.default()` supplies — and does not expose it in the public types. Reading
 * it is unavoidable, since the CLI has to know that `z.string().optional()` is a string
 * that may be absent and no public API answers that.
 *
 * Spelling the cast at each site is avoidable, and it was written four times with four
 * slightly different inline types — four places a Zod upgrade could break silently and
 * independently. Here it breaks one file, loudly.
 */

import type { z } from 'zod';

/** Wrapper kinds that hold an `innerType` the CLI needs to look through. */
export const WRAPPER_TYPES: ReadonlySet<string> = new Set(['optional', 'default', 'nullable', 'prefault']);

/** The internal node behind a schema, as much of it as the CLI reads. */
export interface ZodDef {
  type?: string;
  innerType?: z.ZodType;
  defaultValue?: unknown;
  /** Enum members, keyed by their literal value. */
  entries?: Record<string, string>;
  /** Array element schema. */
  element?: z.ZodType;
  /** Union branches. */
  options?: z.ZodType[];
  /** Refinements attached by `.int()`, `.min()`, and friends. */
  checks?: Array<{ _zod?: { def?: ZodCheckDef } }>;
}

/** A refinement's own node: what it checks and against what. */
export interface ZodCheckDef {
  check?: string;
  format?: string;
  value?: unknown;
  inclusive?: boolean;
}

/** Read a schema's internal node. */
export function zodDef(schema: z.ZodType | undefined): ZodDef | undefined {
  return (schema as unknown as { def?: ZodDef } | undefined)?.def;
}

/** Is this a wrapper the CLI looks through, rather than a leaf type? */
export function isWrapper(def: ZodDef | undefined): boolean {
  return def?.type !== undefined && WRAPPER_TYPES.has(def.type);
}

/**
 * Every schema in a field's wrapper chain, outermost first. Callers walk chains for
 * different reasons — collecting `.meta()` at each level, finding the innermost leaf's
 * type, locating a `.default()` — so they share the traversal and not the conclusion.
 */
export function wrapperChain(field: z.ZodType): z.ZodType[] {
  const chain: z.ZodType[] = [];
  let cursor: z.ZodType | undefined = field;
  while (cursor) {
    chain.push(cursor);
    const def = zodDef(cursor);
    cursor = isWrapper(def) ? def?.innerType : undefined;
  }
  return chain;
}

/** What a number field accepts, beyond being a number. */
export interface NumberConstraints {
  integer: boolean;
  min?: number;
  max?: number;
}

/**
 * The bounds a number field declares.
 *
 * A parse failure has to say what the parameter accepts, and the schema is where that
 * is stated — reading it here is what lets a command line report "must be a
 * non-negative integer" for a value that is not a number at all, which is the point at
 * which no schema check has run yet.
 */
export function numberConstraints(field: z.ZodType): NumberConstraints {
  const constraints: NumberConstraints = { integer: false };
  for (const link of wrapperChain(field)) {
    for (const check of zodDef(link)?.checks ?? []) {
      const def = check._zod?.def;
      if (!def) {
        continue;
      }
      if (def.check === 'number_format' && def.format?.includes('int')) {
        constraints.integer = true;
      }
      if (def.check === 'greater_than' && typeof def.value === 'number') {
        constraints.min = def.inclusive ? def.value : def.value + Number.EPSILON;
      }
      if (def.check === 'less_than' && typeof def.value === 'number') {
        constraints.max = def.inclusive ? def.value : def.value - Number.EPSILON;
      }
    }
  }
  return constraints;
}

/**
 * The value a `.default()` / `.prefault()` wrapper supplies, if there is one. The
 * Commander adapter displays it and the interface renderer publishes it, both from
 * here, so the two cannot disagree about what a parameter defaults to.
 */
export function zodDefaultValue(field: z.ZodType): { present: boolean; value?: unknown } {
  for (const link of wrapperChain(field)) {
    const def = zodDef(link);
    if (def?.type === 'default' || def?.type === 'prefault') {
      const supplied = def.defaultValue;
      return { present: true, value: typeof supplied === 'function' ? (supplied as () => unknown)() : supplied };
    }
  }
  return { present: false };
}
