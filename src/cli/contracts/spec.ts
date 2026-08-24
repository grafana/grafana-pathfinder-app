/**
 * Command specifications (RFC CLI-MCP-COMMAND-CONTRACT §8.2).
 *
 * A `CommandSpec` pairs the Zod object that is the sole authority for a
 * command's input shape with the runner that consumes the validated result.
 * Both entrypoints are renderers over this: the Commander adapter parses text
 * into schema shape, the MCP adapter receives schema shape directly.
 *
 * Nothing here describes a surface. That a parameter is typed positionally,
 * prints `<jsonpath>`, or is withheld from agents are statements about a reader,
 * made by the adapter serving it (`CommanderPresentation` in
 * `render-commander.ts`, the withhold list in `mcp/lib/command-interface.ts`).
 */

import { z } from 'zod';

import type { CommandOutcome } from '../utils/output';
import { PARAM_ROLES, resolveParamPolicy, type ParamPolicy } from './policy';

export interface CommandSpec<S extends z.ZodObject = z.ZodObject> {
  /** Command name as invoked: `remove-block`. */
  name: string;
  /** One-line description; becomes Commander's `.description()` and help `summary`. */
  summary: string;
  /** Sole authority for the command's input shape. */
  schema: S;
  /**
   * What the CLI writes on success.
   *
   * - `outcome` (the default) prints the structured report.
   * - `artifact` writes `outcome.artifact` as JSON and nothing else, for a command
   *   whose stdout is a data contract rather than a report: `schema guide >
   *   guide-schema.json` redirects it to a file, so a summary line would corrupt it.
   * - `stream` means the runner does all its own writing — progress lines, a test
   *   report, a generated file — so the adapter prints nothing and only maps status
   *   to an exit code. For commands whose output predates the outcome envelope and
   *   is consumed by humans and CI as-is.
   */
  emits?: 'outcome' | 'artifact' | 'stream';
  /** Pure command body. Receives the parsed, validated input. */
  run(input: z.output<S>): Promise<CommandOutcome> | CommandOutcome;
}

/** A schema field paired with its resolved policy, in declaration order. */
export interface SpecField {
  name: string;
  field: z.ZodType;
  policy: ParamPolicy;
}

function shapeOf(schema: z.ZodObject): Record<string, z.ZodType> {
  return schema.shape as Record<string, z.ZodType>;
}

/**
 * Validate a spec and freeze it.
 *
 * A field with no role is a build error rather than a silent default (§8.5
 * decision (c)): it would otherwise fall through as an ordinary published content
 * parameter, which is permissive by accident.
 */
export function defineCommand<S extends z.ZodObject>(spec: CommandSpec<S>): CommandSpec<S> {
  const shape = shapeOf(spec.schema);
  const rolelessFields = Object.keys(shape).filter((name) => resolveParamPolicy(shape[name]!) === undefined);
  if (rolelessFields.length > 0) {
    throw new Error(
      `Command "${spec.name}": ${rolelessFields.length} field(s) declare no role: ${rolelessFields.join(', ')}. ` +
        `Add .meta({ role: … }) with one of: ${PARAM_ROLES.join(' | ')}.`
    );
  }

  return Object.freeze({ ...spec });
}

/**
 * Fields in declaration order, which is the order every reader sees them in.
 * Commander renders options in registration order and the adapter registers them
 * in this one, which is what makes a generated command's help match the
 * hand-written declaration it replaced.
 */
export function specFields(spec: CommandSpec): SpecField[] {
  const shape = shapeOf(spec.schema);
  return Object.keys(shape).map((name) => ({
    name,
    field: shape[name]!,
    // `defineCommand` guarantees a resolvable policy for every field.
    policy: resolveParamPolicy(shape[name]!)!,
  }));
}
