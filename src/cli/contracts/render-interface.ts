/**
 * The published-interface renderer (RFC CLI-MCP-COMMAND-CONTRACT §8.4 Stage 8a).
 *
 * Produces the `HelpJson` shape directly from a command's schema, replacing the
 * projection in `mcp/lib/command-interface.ts` that walked Commander and
 * re-derived every fact from option flags. Nothing here reads a Commander
 * object, so the three facts the old projection had to guess — value type,
 * requiredness, and whether a parameter counts as addressing — are read rather
 * than inferred.
 *
 * Two things about a published parameter are the reader's business rather than
 * the command's: what it is called (`--target-url-prefix` on a command line,
 * `targetUrlPrefix` to an agent) and whether that reader is offered it at all.
 * Rather than enumerate readers here, this module asks a `SurfaceView` — so
 * audience stays out of the contracts layer, and adding a reader is a new view
 * object rather than a new branch in every function below.
 */

import type { z } from 'zod';

import { describeField, fieldHelpText, isRepresentableField } from '../utils/schema-options';
import { spellParams, type ParamSpelling } from '../utils/param-spelling';
import type { HelpJson, HelpJsonFlag } from '../utils/output';
import { zodDefaultValue } from '../utils/zod-internals';
import { specFields, type CommandSpec, type SpecField } from './spec';

/**
 * One reader's view of a command's parameters.
 *
 * Supplied by the surface that serves that reader: `CLI_VIEW` in the Commander
 * adapter, `agentView(command)` in the MCP binding.
 */
export interface SurfaceView {
  /** What this reader calls the parameter. */
  name(field: SpecField): string;
  /** Is this reader offered the parameter at all? */
  publishes(field: SpecField): boolean;
  /** How this reader writes a parameter another one's description refers to. */
  spell?: ParamSpelling;
  /**
   * How this reader is told about the parameter, beyond what the schema states.
   *
   * The escape hatch for guidance that is only true of one reader: "run
   * `pathfinder-cli requirements list`" is useful to a person at a shell and
   * unactionable for an agent with no such tool. Overriding here — rather than
   * writing one reader's advice into the schema, or keeping a table of corrections
   * per surface — keeps the description one declaration with one rendering each.
   */
  describe?(field: SpecField, stated: string): string;
}

/**
 * Authoring parameters whose values are requirement expressions.
 *
 * A fact the two CLI surfaces share, not a fact about the runtime vocabulary:
 * `--requirements` / `--conditions` (and the same names on the agent surface)
 * take tokens. How a reader is *told* about those tokens is each view's
 * `describe` — the command line points at `requirements list`, the agent
 * surface illustrates. The runtime types module does not know about either.
 */
export function carriesRequirementTokens(paramName: string): boolean {
  return paramName === 'requirements' || paramName === 'conditions';
}

/** A short, stable sample of the vocabulary, for surfaces that can only illustrate it. */
export const REQUIREMENT_TOKEN_EXAMPLES = 'is-admin, on-page:/dashboards';

/**
 * What one reader is told about a field: what the schema states, with parameter
 * references spelled that reader's way, plus anything only that reader needs.
 */
export function describeFor(entry: SpecField, view: SurfaceView): string {
  const stated = spellParams(fieldHelpText(entry.name, entry.field), view.spell ?? ((name) => name));
  return view.describe?.(entry, stated) ?? stated;
}

/** The `valueType` a field publishes. One cascade, driven by Zod. */
function valueTypeOf(field: z.ZodType): HelpJsonFlag['valueType'] {
  const shape = describeField(field);
  switch (shape.kind) {
    case 'boolean':
      return 'boolean';
    case 'number':
      return 'number';
    case 'enum':
      return 'enum';
    case 'array-string':
    case 'array-enum':
      return 'array';
    default:
      return 'string';
  }
}

function flagFor(entry: SpecField, view: SurfaceView): HelpJsonFlag {
  const shape = describeField(entry.field);
  const valueType = valueTypeOf(entry.field);
  const fallback = zodDefaultValue(entry.field);

  return {
    // The whole of the translation §2 found leaking — `id` vs `--id` — happening
    // once, at the boundary, rather than being undone and redone downstream.
    name: view.name(entry),
    valueType,
    description: describeFor(entry, view),
    // Requiredness is stated on every parameter rather than implied by which
    // bucket it lands in. The buckets cannot carry it: `addressing` is a
    // grouping, and a required addressing parameter (`add-step`'s `parent`)
    // would otherwise be indistinguishable from an optional one.
    required: !shape.optional,
    // A repeatable enum publishes both facts: `valueType: 'array'` says send a
    // list, `enum` says what may be in it.
    ...(shape.kind === 'enum' || shape.kind === 'array-enum' ? { enum: shape.values } : {}),
    ...(valueType === 'array' ? { repeatable: true } : {}),
    ...(fallback.present && !(Array.isArray(fallback.value) && fallback.value.length === 0)
      ? { default: fallback.value }
      : {}),
  };
}

function isPublished(entry: SpecField, view: SurfaceView): boolean {
  // A field with no flag spelling cannot be supplied on any path, so no view gets
  // to publish it.
  if (!isRepresentableField(entry.field)) {
    return false;
  }
  return view.publishes(entry);
}

/** Render a spec's parameter interface for one reader. */
export function renderInterface(spec: CommandSpec, view: SurfaceView): HelpJson {
  const required: HelpJsonFlag[] = [];
  const optional: HelpJsonFlag[] = [];
  const addressing: HelpJsonFlag[] = [];

  for (const entry of specFields(spec)) {
    if (!isPublished(entry, view)) {
      continue;
    }
    const flag = flagFor(entry, view);
    if (entry.policy.role === 'addressing') {
      addressing.push(flag);
    } else if (flag.required) {
      required.push(flag);
    } else {
      optional.push(flag);
    }
  }

  const result: HelpJson = { command: spec.name, summary: spec.summary, required, optional };
  if (addressing.length > 0) {
    result.addressing = addressing;
  }
  return result;
}

/**
 * Every parameter name a spec publishes to one reader, in schema field names
 * rather than the view's spelling — callers reason about the command with these,
 * they do not print them.
 */
export function publishedNames(spec: CommandSpec, view: SurfaceView): string[] {
  return specFields(spec)
    .filter((entry) => isPublished(entry, view))
    .map((entry) => entry.name);
}

/** Parameter names the caller must supply, in field names like `publishedNames`. */
export function requiredNames(spec: CommandSpec, view: SurfaceView): string[] {
  return specFields(spec)
    .filter((entry) => isPublished(entry, view) && !describeField(entry.field).optional)
    .map((entry) => entry.name);
}
