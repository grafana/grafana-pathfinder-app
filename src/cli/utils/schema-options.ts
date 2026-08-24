/**
 * What a Zod field is, for whoever has to expose it.
 *
 * One type cascade — `describeField` — and every surface reads it: the flag spelling a
 * Commander option needs, the value type the agent interface publishes. Both being
 * downstream of the same answer is what stops them disagreeing about whether a
 * parameter is an enum, an array, or an array of enums, which §2.b named as a stability
 * hazard when it was pinned by option-construction order instead.
 *
 * Deliberately parser-free: building the `Option` itself lives in
 * `contracts/commander-options`, so asking what a field is costs no dependency on the
 * surface that happens to ask. Deciding *which* fields become parameters is not here
 * either — this module used to walk a runtime schema and skip fields by name (`type`,
 * `blocks`, `steps`), which also dropped `create --type`, a package-type enum with
 * nothing to do with block discriminators (§3.4 i). A command schema states its own
 * parameters instead.
 *
 * See docs/design/AGENT-AUTHORING.md#schema-driven-option-generation for the
 * type mapping table and rationale.
 */

import { z } from 'zod';

import { fieldNameToFlag } from './param-spelling';
import { zodDef } from './zod-internals';

/**
 * Categorical description of a Zod field for the purpose of exposing it as a
 * parameter. Returned by `describeField()` and read by both the Commander option
 * builder and the agent-facing interface renderer, so the two cannot disagree
 * about what kind of value a parameter takes.
 */
export type FieldShape =
  | { kind: 'string'; optional: boolean; description: string | undefined }
  | { kind: 'number'; optional: boolean; description: string | undefined }
  | { kind: 'boolean'; optional: boolean; description: string | undefined }
  | { kind: 'enum'; optional: boolean; values: readonly string[]; description: string | undefined }
  | { kind: 'array-string'; optional: boolean; description: string | undefined }
  // A repeatable parameter with constrained members. `z.array(z.enum([…]))` used to
  // fall through to `unsupported`, so `set-manifest --target-platform` hand-built its
  // Option and the agent surface recovered the members from Commander's `argChoices`
  // — the enum living in a presentation object rather than the schema (§2.b).
  | { kind: 'array-enum'; optional: boolean; values: readonly string[]; description: string | undefined }
  // `description` is on every variant, including the two that cannot become a flag: a
  // `.describe()` on a literal is still the author's text, and omitting it here only
  // forced readers to narrow the union to ask a question all seven kinds answer.
  | { kind: 'literal'; optional: boolean; description: string | undefined }
  | { kind: 'unsupported'; reason: string; optional: boolean; description: string | undefined };

/**
 * Inspect a Zod field and report its shape in bridge-friendly terms.
 *
 * Optional fields are detected at any wrapping depth — `z.string().optional()`
 * and `z.optional(z.string())` both report `{ kind: 'string', optional: true }`.
 * Defaults wrap their inner type the same way and are also unwrapped.
 *
 * Returns `kind: 'unsupported'` (rather than throwing) for nested objects,
 * unions, and other shapes that don't map cleanly to a single CLI flag. The
 * caller decides whether to skip the field or surface a registration error.
 */
export function describeField(field: z.ZodType): FieldShape {
  // Pull description off the outer wrapper if present, else from whatever inner
  // type ends up being canonical. .describe() metadata flows out through the
  // outermost `description` accessor.
  const description = field.description;

  // Unwrap .optional() / .default() / .nullable() chains — any of them means the
  // field may be absent from the input.
  let optional = false;
  let def = zodDef(field);
  while (def && (def.type === 'optional' || def.type === 'default' || def.type === 'nullable')) {
    optional = true;
    if (!def.innerType) {
      break;
    }
    def = zodDef(def.innerType);
  }

  const t = def?.type;

  if (t === 'string') {
    return { kind: 'string', optional, description };
  }
  if (t === 'number') {
    return { kind: 'number', optional, description };
  }
  if (t === 'boolean') {
    return { kind: 'boolean', optional, description };
  }
  if (t === 'literal') {
    return { kind: 'literal', optional, description };
  }
  if (t === 'enum') {
    // Zod v4 stores enum members as { entries: { key: value, ... } }.
    // Object keys are the literal string values for `z.enum([...])`.

    const entries = def?.entries;
    const values = entries ? Object.keys(entries) : [];
    return { kind: 'enum', optional, values, description };
  }
  if (t === 'array') {
    const elementType = zodDef(def?.element)?.type;
    if (elementType === 'string') {
      return { kind: 'array-string', optional, description };
    }
    if (elementType === 'enum') {
      const members = zodDef(def?.element)?.entries;
      return { kind: 'array-enum', optional, values: members ? Object.keys(members) : [], description };
    }
    // Manifest dependency lists are `z.array(z.union([z.string(), z.array(z.string())]))`
    // — the OR-group case (string[] alternatives) is rare in CLI use and
    // requires manual JSON editing. Treat the union-element array as an
    // array-string flag if any branch of the union is a string; users get
    // the bare-string path via the CLI and can fall back to manual JSON
    // editing for OR-groups.
    if (elementType === 'union') {
      const branches = zodDef(def?.element)?.options ?? [];
      const acceptsString = branches.some((branch) => zodDef(branch)?.type === 'string');
      if (acceptsString) {
        return { kind: 'array-string', optional, description };
      }
    }
    return { kind: 'unsupported', reason: `array of ${elementType ?? 'unknown'}`, optional, description };
  }

  return { kind: 'unsupported', reason: t ?? 'unknown', optional, description };
}

// Re-exported for the readers that ask a field's shape and its flag name together;
// owned by `param-spelling`, which is also where the outcome-side spelling reads it.
export { fieldNameToFlag };

/**
 * Can this field be expressed as a single command-line parameter? Nested objects,
 * unions of non-primitives, and literals cannot. Shared by the Commander adapter and
 * the interface renderer, since publishing a parameter neither can accept is worse
 * than omitting it — an agent would send it and have it silently dropped.
 */
export function isRepresentableField(field: z.ZodType): boolean {
  const kind = describeField(field).kind;
  return kind !== 'literal' && kind !== 'unsupported';
}

/**
 * What the schema says about a field, for any surface: its `.describe()`, or a
 * type-shaped fallback for the fields that have none.
 *
 * Nothing here is addressed to a particular reader. Anything that would be — where to
 * look up a vocabulary, what to type — is added by that reader's `SurfaceView.describe`.
 */
export function fieldHelpText(name: string, field: z.ZodType): string {
  const shape = describeField(field);
  return shape.description ?? `${name} (${shape.kind}${shape.optional ? ', optional' : ''})`;
}
