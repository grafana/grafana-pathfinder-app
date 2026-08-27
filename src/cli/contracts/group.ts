/**
 * Command groups — a family of variants selected by one discriminator
 *
 * `add-block <type>` is one command root with fifteen shapes. Each shape is an
 * ordinary `CommandSpec`, so the root keeps a 1:1 relationship between a schema
 * object and a thing you can invoke; the group is the enumeration of those
 * shapes, not a merge of them.
 *
 * ## Why this is not a `z.discriminatedUnion` on the wire
 *
 * A discriminated union is the natural Zod spelling and the wrong published shape:
 * it renders to JSON Schema `oneOf`/`anyOf`, which MCP clients do not reliably
 * consume. So the union stays *internal* — Commander gets real subcommands, and a
 * variant's runner parses against that variant's schema alone — while
 * `renderGroupInterface` flattens the published view: the discriminator becomes a
 * required `enum`, asking about a variant returns its parameters flat, and
 * `requiredByType` summarises every variant's obligations so choosing a type costs
 * no extra round-trip. It is a declared layer rather than a property that happens
 * to hold, because it is the only thing standing between the union and the agent.
 *
 * Mounting a group as real subcommands is `render-commander`'s job, not this file's:
 * what a family of variants *is* holds whether or not a command line ever renders it.
 */

import type { HelpJson, HelpJsonFlag } from '../utils/output';
import { renderInterface, requiredNames, type SurfaceView } from './render-interface';
import type { CommandSpec } from './spec';

export interface CommandGroupSpec {
  /** Root command name as invoked: `add-block`. */
  name: string;
  /** One-line description. The agent surface publishes exactly this. */
  summary: string;
  /** Parameter that selects the variant: `type`. */
  discriminator: string;
  /** Description published for the discriminator itself. */
  discriminatorDescription: string;
  /** Variant name → spec. Iteration order is the published order. */
  variants: ReadonlyMap<string, CommandSpec>;
}

export function defineCommandGroup(group: CommandGroupSpec): CommandGroupSpec {
  if (group.variants.size === 0) {
    throw new Error(`Command group "${group.name}" declares no variants.`);
  }
  for (const [name, spec] of group.variants) {
    if (group.discriminator in spec.schema.shape) {
      throw new Error(
        `Command group "${group.name}" variant "${name}" declares a "${group.discriminator}" field. ` +
          `The discriminator is supplied by the group and must not appear in a variant schema.`
      );
    }
  }
  return Object.freeze({ ...group });
}

/** Variant names, in published order. */
export function variantNames(group: CommandGroupSpec): string[] {
  return [...group.variants.keys()];
}

/** The discriminator as a published parameter. */
function discriminatorFlag(group: CommandGroupSpec): HelpJsonFlag {
  return {
    name: group.discriminator,
    valueType: 'enum',
    enum: variantNames(group),
    description: group.discriminatorDescription,
    required: true,
  };
}

/**
 * Each variant's required parameter names, derived from the variant schemas rather
 * than accumulated as commands register — so a field that becomes required cannot
 * be missing from this table.
 */
export function requiredByVariant(group: CommandGroupSpec, view: SurfaceView): Record<string, string[]> {
  const table: Record<string, string[]> = {};
  for (const [name, spec] of group.variants) {
    table[name] = requiredNames(spec, view);
  }
  return table;
}

/**
 * The group's published interface — the root listing when `variant` is absent,
 * or one variant's flat parameter set when present.
 */
export function renderGroupInterface(group: CommandGroupSpec, view: SurfaceView, variant?: string): HelpJson {
  const selector = discriminatorFlag(group);

  if (variant === undefined) {
    return {
      command: group.name,
      summary: group.summary,
      required: [selector],
      optional: [],
      subcommands: variantNames(group),
      requiredByType: requiredByVariant(group, view),
    };
  }

  const spec = group.variants.get(variant)!;
  const base = renderInterface(spec, view);
  // The discriminator leads the required list: it is the parameter that decides
  // what the rest of the interface means.
  return { ...base, required: [selector, ...base.required] };
}
