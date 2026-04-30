/**
 * Zod-to-Commander bridge.
 *
 * Generates Commander options from a Zod object schema by walking its `.shape`.
 * Each authoring command uses this to keep its flag surface tightly coupled to
 * the schema — when a field is added or annotated in `json-guide.schema.ts` or
 * `package.schema.ts`, the new flag and help text appear automatically.
 *
 * See docs/design/AGENT-AUTHORING.md#schema-driven-option-generation for the
 * type mapping table and rationale.
 */

import { InvalidArgumentError, Option, type Command } from 'commander';
import { z } from 'zod';

/**
 * Field names that the bridge must never expose as flags. The block-type
 * discriminator (`type`) becomes the subcommand name; structural fields are
 * populated by sibling commands (`add-block`, `add-step`, `add-choice`) or by
 * the recursive editor that owns the parent.
 */
export const STRUCTURAL_SKIP_FIELDS: ReadonlySet<string> = new Set([
  'type',
  'blocks',
  'whenTrue',
  'whenFalse',
  'steps',
  'choices',
]);

/**
 * Categorical description of a Zod field as understood by the bridge. Returned
 * by `describeField()` and consumed by both option registration and the
 * inverse `parseOptionValues()` helper, so the two stay in lockstep.
 */
export type FieldShape =
  | { kind: 'string'; optional: boolean; description: string | undefined }
  | { kind: 'number'; optional: boolean; description: string | undefined }
  | { kind: 'boolean'; optional: boolean; description: string | undefined }
  | { kind: 'enum'; optional: boolean; values: readonly string[]; description: string | undefined }
  | { kind: 'array-string'; optional: boolean; description: string | undefined }
  | { kind: 'literal'; optional: boolean }
  | { kind: 'unsupported'; reason: string; optional: boolean };

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
  const description = (field as unknown as { description?: string }).description;

  let optional = false;
  let inner: z.ZodType = field;

  // Unwrap .optional() / .default() chains.
  // Zod v4 stores these as { def: { type: 'optional' | 'default', innerType } }.

  let def: any = (inner as unknown as { def?: { type?: string; innerType?: z.ZodType } }).def;
  while (def && (def.type === 'optional' || def.type === 'default' || def.type === 'nullable')) {
    optional = true;
    if (!def.innerType) {
      break;
    }
    inner = def.innerType;
    def = (inner as unknown as { def?: { type?: string; innerType?: z.ZodType } }).def;
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
    return { kind: 'literal', optional };
  }
  if (t === 'enum') {
    // Zod v4 stores enum members as { entries: { key: value, ... } }.
    // Object keys are the literal string values for `z.enum([...])`.

    const entries = (def as any).entries as Record<string, string> | undefined;
    const values = entries ? Object.keys(entries) : [];
    return { kind: 'enum', optional, values, description };
  }
  if (t === 'array') {
    const element = (def as any).element;
    const elementType = element?.def?.type;
    if (elementType === 'string') {
      return { kind: 'array-string', optional, description };
    }
    // Manifest dependency lists are `z.array(z.union([z.string(), z.array(z.string())]))`
    // — the OR-group case (string[] alternatives) is rare in CLI use and
    // requires manual JSON editing. Treat the union-element array as an
    // array-string flag if any branch of the union is a string; users get
    // the bare-string path via the CLI and can fall back to manual JSON
    // editing for OR-groups.
    if (elementType === 'union') {
      const branches: Array<{ def?: { type?: string } }> = element?.def?.options ?? [];
      const acceptsString = branches.some((branch) => branch?.def?.type === 'string');
      if (acceptsString) {
        return { kind: 'array-string', optional, description };
      }
    }
    return { kind: 'unsupported', reason: `array of ${elementType ?? 'unknown'}`, optional };
  }

  return { kind: 'unsupported', reason: t ?? 'unknown', optional };
}

/**
 * camelCase → kebab-case for CLI flag names.
 *
 * `showMe` → `show-me`, `validateInput` → `validate-input`.
 * Already-lowercase names like `reftarget` pass through unchanged.
 */
export function fieldNameToFlag(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * Build a Commander `Option` for a single Zod field, or return `null` if the
 * field should not surface as a flag.
 *
 * Returns `null` for:
 * - Fields named in `STRUCTURAL_SKIP_FIELDS` (`type`, `blocks`, `steps`, ...).
 * - `z.literal(...)` fields (they encode discriminators, not user input).
 * - Unsupported shapes (nested objects, unions of non-primitives).
 *
 * `name` is the camelCase property name from the schema; the resulting flag is
 * kebab-cased.
 */
export function zodFieldToOption(name: string, field: z.ZodType): Option | null {
  if (STRUCTURAL_SKIP_FIELDS.has(name)) {
    return null;
  }

  const shape = describeField(field);
  const flag = fieldNameToFlag(name);

  if (shape.kind === 'literal' || shape.kind === 'unsupported') {
    return null;
  }

  const fallbackDescription = `${name} (${shape.kind}${shape.optional ? ', optional' : ''})`;
  let description = shape.description ?? fallbackDescription;

  // Surface the canonical requirement vocabulary on the two flags that take
  // requirement tokens, so authors discover valid values without invoking
  // `pathfinder-cli requirements list`. Schema-level refinement still
  // enforces the vocabulary; this is purely a help-text enrichment.
  if (name === 'requirements' || name === 'conditions') {
    description = `${description} | run "pathfinder-cli requirements list" for valid tokens (e.g., is-admin, on-page:/dashboards)`;
  }

  if (shape.kind === 'boolean') {
    const option = new Option(`--${flag}`, description);
    if (!shape.optional) {
      option.makeOptionMandatory();
    }
    return option;
  }

  if (shape.kind === 'enum') {
    const option = new Option(`--${flag} <${shape.values.join('|')}>`, description);
    if (shape.values.length > 0) {
      option.choices(shape.values);
    }
    if (!shape.optional) {
      option.makeOptionMandatory();
    }
    return option;
  }

  if (shape.kind === 'array-string') {
    // Repeatable: each --flag <item> appends to the accumulated array.
    const option = new Option(`--${flag} <item>`, description);
    option.argParser((value: string, previous: string[] | undefined) => [...(previous ?? []), value]);
    option.default([] as string[]);
    if (!shape.optional) {
      option.makeOptionMandatory();
    }
    return option;
  }

  if (shape.kind === 'number') {
    const option = new Option(`--${flag} <number>`, description);
    option.argParser((value: string) => {
      const n = Number(value);
      if (Number.isNaN(n)) {
        throw new InvalidArgumentError(`--${flag} must be a number, got "${value}"`);
      }
      return n;
    });
    if (!shape.optional) {
      option.makeOptionMandatory();
    }
    return option;
  }

  // string
  const option = new Option(`--${flag} <string>`, description);
  if (!shape.optional) {
    option.makeOptionMandatory();
  }
  return option;
}

/**
 * Walk `schema.shape` and add one Commander option per field to `cmd`. Returns
 * `cmd` for chaining.
 *
 * The set of fields registered, their flag names, and their help text are
 * derived entirely from the schema. This is the structural mechanism that
 * keeps `pathfinder-cli <command> --help` in lockstep with the Zod source of
 * truth.
 *
 * Fields that don't map cleanly (`literal`, structural fields, nested
 * objects) are silently skipped. Use `describeField()` directly if you need
 * to detect or surface those.
 */
/**
 * Set of flag names that are *logically* required (per the underlying schema)
 * but were registered with `forceOptional: true` so the command can defer
 * required-field checking to a single Zod `safeParse`. `formatHelpAsJson`
 * consults this list to keep the help-shape `required` bucket accurate even
 * when Commander itself sees the options as optional. Stored on the command
 * via a non-enumerable property so the rest of the Commander API is
 * unaffected.
 */
export const SCHEMA_REQUIRED_KEY = '__schemaRequiredFlagNames';

export function getSchemaRequiredFlagNames(cmd: Command): ReadonlySet<string> | undefined {
  const value = (cmd as unknown as Record<string, unknown>)[SCHEMA_REQUIRED_KEY];
  return value instanceof Set ? (value as ReadonlySet<string>) : undefined;
}

export function registerSchemaOptions<T extends z.ZodObject>(
  cmd: Command,
  schema: T,
  options: {
    skipExisting?: boolean;
    /**
     * Force every generated option to be non-mandatory. Used by `edit-block`,
     * which composes flags from many block schemas — required-on-create
     * fields (like `image.src`) are not required-on-patch — and by
     * `add-block` subcommands, which defer required-field checking to a
     * single Zod parse so multiple missing fields surface together instead
     * of Commander short-circuiting on the first one.
     */
    forceOptional?: boolean;
  } = {}
): Command {
  // Track logically-required flags when forceOptional is set so help output
  // and downstream consumers still know the truth.
  const requiredNames = new Set<string>(getSchemaRequiredFlagNames(cmd) ?? []);
  const shape = schema.shape as Record<string, z.ZodType>;
  // Pre-compute the set of long flags already registered on this command so
  // multi-schema callers (notably `edit-block`, which unions every block
  // schema's flag surface) can layer schemas without colliding on shared
  // fields like `--id`.
  const existing = new Set(cmd.options.map((o) => o.long ?? '').filter(Boolean));
  for (const [name, field] of Object.entries(shape)) {
    const option = zodFieldToOption(name, field);
    if (!option) {
      continue;
    }
    const wasMandatory = option.mandatory === true;
    if (options.forceOptional) {
      option.mandatory = false;
      if (wasMandatory) {
        const longName = (option.long ?? '').replace(/^--/, '');
        if (longName) {
          requiredNames.add(longName);
        }
      }
    }
    if (options.skipExisting && existing.has(option.long ?? '')) {
      continue;
    }
    if (existing.has(option.long ?? '')) {
      // Without `skipExisting`, fall back to the historical behavior so
      // callers that *expect* a clean schema get a loud failure rather than
      // a silent overwrite.
      cmd.addOption(option);
    } else {
      cmd.addOption(option);
      existing.add(option.long ?? '');
    }
  }
  // Always stash the set when forceOptional is in use, even if it's empty —
  // callers (notably add-block) need a mutable handle so they can layer in
  // CLI-level required flags (`--id` for containers, `--conditions` for
  // conditional blocks) that the schema marks optional.
  if (requiredNames.size > 0 || options.forceOptional) {
    Object.defineProperty(cmd, SCHEMA_REQUIRED_KEY, {
      value: requiredNames,
      writable: true,
      enumerable: false,
      configurable: true,
    });
  }
  return cmd;
}

/**
 * Inverse of registration: project a Commander option-values object back into
 * a plain object whose keys match `schema.shape` and whose values are the raw
 * values the schema expects to validate.
 *
 * Commander stores parsed values under the camelCase attribute name derived
 * from the long flag — `--show-me` produces `opts.showMe`. We forward those
 * through unchanged for fields the bridge knows how to handle, and drop unknown
 * keys so `validatePackage()` doesn't see surprise fields.
 *
 * Boolean flags that were never set arrive as `undefined`; we leave them
 * absent on the result. Repeatable arrays default to `[]` from registration;
 * we strip the empty default so optional arrays stay truly optional.
 */
export function parseOptionValues<T extends z.ZodObject>(
  schema: T,
  values: Record<string, unknown>
): Record<string, unknown> {
  const shape = schema.shape as Record<string, z.ZodType>;
  const out: Record<string, unknown> = {};

  for (const [name, field] of Object.entries(shape)) {
    if (STRUCTURAL_SKIP_FIELDS.has(name)) {
      continue;
    }
    const description = describeField(field);
    if (description.kind === 'literal' || description.kind === 'unsupported') {
      continue;
    }
    const raw = values[name];
    if (raw === undefined) {
      continue;
    }
    if (description.kind === 'array-string') {
      if (Array.isArray(raw) && raw.length === 0 && description.optional) {
        // Don't pass an empty array through for optional repeatable flags —
        // it lets the schema's optional handling kick in cleanly.
        continue;
      }
      out[name] = raw;
      continue;
    }
    out[name] = raw;
  }

  return out;
}
