/**
 * Composing command schemas over shared runtime schemas
 *
 * `json-guide.schema.ts` and `package.schema.ts` are imported by ~30 non-CLI modules
 * — the block editor, `src/validation/*`, `src/package-engine/*`, `learning-paths`,
 * `docs-retrieval`, the assistant integration — so a command must not annotate them
 * in place: `role: 'addressing'` on `JsonStepSchema.shape.id` would push command-line
 * concerns into the plugin runtime. Command schemas therefore *extend* rather than
 * annotate, and `withPolicy` attaches policy to copies.
 *
 * A schema built this way carries per-field types, requiredness, and policy, but not
 * the runtime schema's cross-field refinements — `z.object({...})` cannot inherit a
 * `.refine()` from a shape. So the runner still parses the content sub-object against
 * the runtime schema: the command schema decides whether the *input* is well-formed,
 * the runtime schema whether the resulting *artifact* is legal.
 */

import { z } from 'zod';

import { zodDef } from '../utils/zod-internals';
import type { DeclaredPolicy } from './policy';

/**
 * A shape whose fields are the classic `z.ZodType`.
 *
 * Zod v4's `z.ZodRawShape` describes fields as the core `$ZodType`, which validates
 * but carries none of the fluent surface (`.describe()`, `.meta()`, `.optional()`)
 * these helpers are built on. This alias keeps a field read out of a shape the same
 * type as one written into it.
 */
export type CommandShape = Record<string, z.ZodType>;

/**
 * Copy a shape, attaching `policy` to every field, with optional per-field
 * overrides. The input shape is not modified.
 */
export function withPolicy<S extends CommandShape>(
  shape: S,
  policy: DeclaredPolicy,
  overrides: Partial<Record<keyof S, DeclaredPolicy>> = {}
): S {
  // The cast restores what `.meta()` erases: metadata cannot change what a field
  // parses, so each copy is still its original type, but Zod types `.meta()` as
  // returning the widened `z.ZodType`. Declaring that wider type instead would infer
  // every content field as `unknown` on the assembled command schema.
  const out: Record<string, z.ZodType> = {};
  for (const [name, field] of Object.entries(shape)) {
    out[name] = field.meta({ ...policy, ...(overrides[name as keyof S] ?? {}) });
  }
  return out as unknown as S;
}

/**
 * Strip a field's optional/default wrappers, making it required — for requirements the
 * CLI imposes that the runtime schema does not. A conditional block must declare
 * conditions at creation time, but the block schema keeps the field optional so
 * existing content still loads. The description is carried over, since unwrapping
 * drops whatever the wrapper levels declared.
 */
export function required(field: z.ZodType): z.ZodType {
  const description = field.description;
  // `nullable` is not unwrapped: null is a value the field accepts rather than a way
  // of being absent, so stripping it would change what validates.
  let innermost: z.ZodType = field;
  for (;;) {
    const def = zodDef(innermost);
    if (def?.type === undefined || !UNWRAPPABLE.has(def.type) || !def.innerType) {
      break;
    }
    innermost = def.innerType;
  }
  return description === undefined ? innermost : innermost.describe(description);
}

const UNWRAPPABLE: ReadonlySet<string> = new Set(['optional', 'default', 'prefault']);

/**
 * Restate a shape as patch parameters: every field optional, no defaults.
 *
 * For commands that edit an existing artifact, where absence has to mean "leave this
 * field alone" — a creation default contradicts that, since `repository` defaults to
 * `interactive-tutorials` and a defaulted parse of `set-manifest --description x`
 * would rewrite it. Stripping defaults makes absence unambiguous in the schema: together
 * with the Commander adapter dropping default-sourced values, a key is in the parsed
 * input if and only if the caller supplied it.
 *
 * Field types widen to `unknown`, since the runtime schema re-validates the patched
 * artifact and this schema's job is the presence and shape of *parameters*. The
 * description is re-attached to the returned wrapper because, unlike policy metadata,
 * no reader walks inward for one.
 */
export function patchShape<S extends CommandShape>(shape: S): { [P in keyof S]: z.ZodOptional<z.ZodType> } {
  const out: Record<string, z.ZodOptional<z.ZodType>> = {};
  for (const [name, field] of Object.entries(shape)) {
    const patched = required(field).optional();
    const description = field.description;
    out[name] = description === undefined ? patched : patched.describe(description);
  }
  return out as { [P in keyof S]: z.ZodOptional<z.ZodType> };
}

/** Field names of a (possibly `.refine()`-wrapped) object schema. */
export function shapeKeys(schema: unknown): string[] {
  return Object.keys((schema as { shape?: Record<string, unknown> }).shape ?? {});
}

/**
 * Extract the content sub-object a runtime schema expects out of the flat parsed
 * input, dropping absent keys and empty repeatables: an unpassed repeatable should
 * leave no trace in the artifact rather than write `"requirements": []` into it. Only
 * an agent can still send an explicit `[]` here — Commander's is dropped as
 * default-sourced — and it means the same thing.
 */
export function pickContent(input: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const value = input[key];
    if (value === undefined || (Array.isArray(value) && value.length === 0)) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * The subset of `keys` the caller actually supplied — the patch counterpart to
 * `pickContent`. On a creation path an empty repeatable and an absent one mean the
 * same thing; on a patch path they do not, since absent means "leave this field
 * alone" and `[]` means "make this field empty". Presence is a safe signal only
 * because defaults are stripped from the schema and dropped by source, so nothing but
 * the caller can put a key in the input.
 */
export function pickSupplied(input: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (input[key] !== undefined) {
      out[key] = input[key];
    }
  }
  return out;
}
