/**
 * The agent-facing command surface.
 *
 * Sits between `pathfinder_help` and the agent. Binding is opt-in: only a
 * command an MCP tool has registered is addressable here at all. Commands the
 * CLI ships but no tool dispatches (`e2e`, `build-graph`, `move-block`, …) are
 * not part of the agent surface, and describing their flags would only invite an
 * agent to author against a tool that does not exist.
 *
 * Two entry points over one source of truth: `formatCommandInterface` publishes
 * a command's schema-rendered interface, `validateCommandArgs` holds an
 * invocation to that same interface. What commands exist comes from the runners'
 * own manifest, so nothing in this module — or anywhere under `mcp/` — reads a
 * Commander object.
 *
 * This module used to *project* the surface out of Commander — rekeying flags to
 * attribute names, inferring value types from flag strings, treating `hideHelp()`
 * as an interface decision. Every bound command declares its shape as a schema now
 * (RFC §8), so a parameter's name is its field name, what it accepts is its type,
 * and what an agent must send is the schema's own requiredness.
 *
 * What stays here is what is about *this* surface: which commands it offers and
 * which of their parameters it withholds. Both are declared by the tool that
 * dispatches the command and checked against the schema at bind time, so this is a
 * translation layer with no authority over shape.
 */

import type { z } from 'zod';

import {
  renderGroupInterface,
  resolveParamPolicy,
  shapeKeys,
  type CommandGroupSpec,
  type CommandSpec,
} from '../../contracts';
import {
  carriesRequirementTokens,
  publishedNames,
  renderInterface,
  requiredNames,
  REQUIREMENT_TOKEN_EXAMPLES,
  type SurfaceView,
} from '../../contracts/render-interface';
import type { CommandOutcome, HelpJson, HelpJsonFlag } from '../../utils/output';
import { COMMAND_GROUPS, COMMAND_SPECS, commandNames, isCommand } from '../../commands/manifest';
import { outcomeResult, type ToolResult } from '../tools/result';

// ----------------- bindings -----------------

/** Bound command name → parameters this surface does not offer agents. */
const BOUND_COMMANDS = new Map<string, ReadonlySet<string>>();

export interface BindOptions {
  /**
   * Parameters the command accepts that agents are not offered, by field name — a
   * narrowing of the agent procedure rather than a fact about the command, so the
   * CLI still offers all of them. Checked against the schema at bind time, which is
   * what keeps it from rotting the way its ancestor `optBlacklist` could.
   */
  withhold?: readonly string[];
}

/** Every field name a command declares, across all variants if it is a group. */
function declaredFieldNames(commandName: string): Set<string> {
  const group = COMMAND_GROUPS.get(commandName);
  if (group) {
    const names = new Set<string>([group.discriminator]);
    for (const variant of group.variants.values()) {
      for (const name of shapeKeys(variant.schema)) {
        names.add(name);
      }
    }
    return names;
  }
  return new Set(shapeKeys(COMMAND_SPECS.get(commandName)!.schema));
}

/**
 * Make a CLI command addressable through `pathfinder_help` and
 * `validateCommandArgs`, from the MCP tool that dispatches it.
 *
 * Registration *is* exposure: a command is on the agent surface because a tool
 * asked for it by name, so shipping a CLI command and exposing it stay separate
 * steps and withdrawing one is a deleted call rather than a deleted implementation.
 *
 * Throws unless the manifest declares the command and it declares every parameter
 * withheld. Either would otherwise leave a tool reachable but unhelpable — the
 * agent getting UNKNOWN_COMMAND from the command its own tool description told it
 * to ask about — so they fail at server boot instead.
 */
export function bindCommandInterface(commandName: string, options: BindOptions = {}): void {
  if (!isCommand(commandName)) {
    throw new Error(
      `Cannot bind MCP interface for "${commandName}": no such command. ` +
        `Known commands: ${commandNames().join(', ')}`
    );
  }

  const withhold = options.withhold ?? [];
  const declared = declaredFieldNames(commandName);
  const unknown = withhold.filter((name) => !declared.has(name));
  if (unknown.length > 0) {
    throw new Error(
      `Cannot bind MCP interface for "${commandName}": withholds parameter(s) it does not declare: ${unknown.join(', ')}. ` +
        `Declared: ${[...declared].sort().join(', ')}`
    );
  }

  BOUND_COMMANDS.set(commandName, new Set(withhold));
}

/** CLI command names that currently have an MCP binding. */
export function registeredCommandInterfaceNames(): ReadonlySet<string> {
  return new Set(BOUND_COMMANDS.keys());
}

/**
 * How agents see a bound command's parameters.
 *
 * Two exclusions, both this surface's own business: `io` parameters, because the
 * transport supplies them — an agent hands over an artifact, not a directory on
 * the server's disk — and the binding's `withhold` list. Names are the schema's,
 * since an agent sends a JSON object rather than typing a command line.
 *
 * An unbound name throws rather than defaulting to "everything but `io`", which
 * would be the permissive answer in a layer where exposure is opt-in. Callers go
 * through `resolveCommandInterface` and get UNKNOWN_COMMAND first, so reaching here
 * without a binding is a caller bug.
 */
export function agentView(commandName: string): SurfaceView {
  const withheld = BOUND_COMMANDS.get(commandName);
  if (!withheld) {
    throw new Error(
      `No MCP binding for "${commandName}": this surface publishes only commands a tool has bound. ` +
        `Bound: ${[...BOUND_COMMANDS.keys()].join(', ') || '(none)'}`
    );
  }
  return {
    name: (field) => field.name,
    publishes: (field) => field.policy.role !== 'io' && !withheld.has(field.name),
    // No tool prints the requirement vocabulary and an agent cannot run the command
    // that does, so the vocabulary is illustrated rather than pointed at. Withholding
    // the CLI recipe is the point: an agent that reads one tends to try it.
    describe: (field, stated) =>
      carriesRequirementTokens(field.name) ? `${stated} | valid tokens include ${REQUIREMENT_TOKEN_EXAMPLES}` : stated,
  };
}

/**
 * Bound command names in manifest order — the same order and membership
 * `pathfinder_help` lists when called with no command, so a rejection points
 * at exactly the set the agent can browse.
 */
export function boundCommandNames(): string[] {
  return commandNames().filter((name) => BOUND_COMMANDS.has(name));
}

// ----------------- command resolution -----------------

export interface CommandInterfaceError {
  status: 'error';
  code: 'UNKNOWN_COMMAND' | 'UNKNOWN_SUBCOMMAND';
  message: string;
}

/**
 * A bound command as its schema declares it: either one spec, or a group and
 * the variant the caller selected (if any).
 */
type ResolvedCommand =
  | { spec: CommandSpec; group?: undefined; variant?: undefined }
  | { spec?: undefined; group: CommandGroupSpec; variant: CommandSpec | undefined };

const COMMAND_INTERFACE_ERROR_CODES = new Set<CommandInterfaceError['code']>(['UNKNOWN_COMMAND', 'UNKNOWN_SUBCOMMAND']);

/** Narrow either entry point's return value to its error branch. */
export function isCommandInterfaceError(value: unknown): value is CommandInterfaceError {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.status === 'error' &&
    typeof record.message === 'string' &&
    typeof record.code === 'string' &&
    COMMAND_INTERFACE_ERROR_CODES.has(record.code as CommandInterfaceError['code'])
  );
}

/**
 * Look up a bound command, optionally descending into one of its variants.
 *
 * An unbound CLI command is reported the same as a name the CLI never had. The
 * distinction is not actionable for an agent — there is no tool to reach it
 * either way — and naming it would advertise capability the surface deliberately
 * excludes.
 */
function resolveCommandInterface(commandName: string, subcommand?: string): ResolvedCommand | CommandInterfaceError {
  const group = BOUND_COMMANDS.has(commandName) ? COMMAND_GROUPS.get(commandName) : undefined;
  const spec = BOUND_COMMANDS.has(commandName) ? COMMAND_SPECS.get(commandName) : undefined;
  if (!group && !spec) {
    return {
      status: 'error',
      code: 'UNKNOWN_COMMAND',
      message: `Unknown command "${commandName}". Available: ${boundCommandNames().join(', ')}`,
    };
  }

  if (!subcommand) {
    return group ? { group, variant: undefined } : { spec: spec! };
  }

  const variant = group?.variants.get(subcommand);
  if (!variant) {
    return {
      status: 'error',
      code: 'UNKNOWN_SUBCOMMAND',
      message: `Unknown ${commandName} subcommand "${subcommand}". Available: ${[
        ...(group?.variants.keys() ?? []),
      ].join(', ')}`,
    };
  }

  return { group: group!, variant };
}

/**
 * Publish a bound command's parameter interface.
 *
 * A group publishes its variants flattened into a discriminator enum, since MCP
 * clients do not reliably consume `oneOf` — see `contracts/group.ts`.
 */
export function formatCommandInterface(commandName: string, subcommand?: string): HelpJson | CommandInterfaceError {
  const resolved = resolveCommandInterface(commandName, subcommand);
  if (isCommandInterfaceError(resolved)) {
    return resolved;
  }
  const view = agentView(commandName);
  return resolved.group
    ? renderGroupInterface(resolved.group, view, resolved.variant?.name)
    : renderInterface(resolved.spec, view);
}

// ----------------- argument validation -----------------

interface OptViolations {
  missing: string[];
  unsupported: string[];
  invalid: Array<{ name: string; expected: string; received: string }>;
  /** Every opt name the interface publishes, echoed back to orient the agent. */
  exposed: string[];
  /** Domain code for a lone missing parameter that declares one. */
  missingCode?: string;
}

/**
 * The variant the agent's own opts select, for a command that is a group.
 *
 * The discriminator is the group's, replacing the binding's `subcommandOpt`: the
 * command that owns the variants is also what names the field that chooses
 * between them.
 */
function derivedSubcommand(commandName: string, opts: Record<string, unknown>): string | undefined {
  const discriminator = COMMAND_GROUPS.get(commandName)?.discriminator;
  const selected = discriminator ? opts[discriminator] : undefined;
  return typeof selected === 'string' && selected !== '' ? selected : undefined;
}

/** Does a bare value match one of the primitive kinds named in `unionOf`? */
function matchesPrimitiveKind(kind: string, value: unknown): boolean {
  if (kind === 'boolean') {
    return typeof value === 'boolean';
  }
  if (kind === 'number') {
    return typeof value === 'number' && Number.isFinite(value);
  }
  return typeof value === 'string';
}

/** Does the value match the type help advertised for this opt? */
function matchesValueType(flag: HelpJsonFlag, value: unknown): boolean {
  switch (flag.valueType) {
    case 'boolean':
      return typeof value === 'boolean';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'array':
      return (
        Array.isArray(value) &&
        value.every((item) => typeof item === 'string' && (flag.enum === undefined || flag.enum.includes(item)))
      );
    case 'enum':
      return typeof value === 'string' && (flag.enum?.includes(value) ?? false);
    case 'union':
      return (flag.unionOf ?? []).some((kind) => matchesPrimitiveKind(kind, value));
    default:
      return typeof value === 'string';
  }
}

function expectedTypeLabel(flag: HelpJsonFlag): string {
  if (flag.valueType === 'enum') {
    return flag.enum?.join('|') ?? 'enum';
  }
  if (flag.valueType === 'union') {
    return flag.unionOf?.join('|') ?? 'union';
  }
  return flag.valueType === 'array' ? 'string[]' : flag.valueType;
}

function receivedTypeLabel(value: unknown): string {
  if (Array.isArray(value)) {
    return 'array';
  }
  return value === null ? 'null' : typeof value;
}

function plural(count: number, noun: string): string {
  return count === 1 ? noun : `${noun}s`;
}

/** Diff the agent's bag against a published interface, whatever produced it. */
function diffViolations(
  published: HelpJsonFlag[],
  requiredBeforeRunner: readonly string[],
  opts: Record<string, unknown>
): OptViolations {
  const exposed = [...new Set(published.map((flag) => flag.name))].sort();
  const exposedSet = new Set(exposed);

  return {
    // Absence only, matching `isAbsence` in `outcome.ts`: `''` is a valid string as
    // far as the schema is concerned, so a command that cares rejects it downstream
    // (e.g. `create`'s `INVALID_TITLE`) rather than preflight guessing at content.
    missing: requiredBeforeRunner.filter((name) => opts[name] === undefined),
    unsupported: Object.keys(opts).filter((name) => !exposedSet.has(name)),
    invalid: published.flatMap((flag) => {
      const value = opts[flag.name];
      return value === undefined || matchesValueType(flag, value)
        ? []
        : [{ name: flag.name, expected: expectedTypeLabel(flag), received: receivedTypeLabel(value) }];
    }),
    exposed,
  };
}

/**
 * Diff the agent's bag against a command's published interface.
 *
 * Requiredness comes from the schema rather than from Commander's `mandatory`
 * bit, which is what let the two disagree: a command that wanted to report every
 * missing field at once had to register its options as non-mandatory and keep the
 * truth in a side table, so help said one thing and the parser enforced another.
 */
function specViolations(spec: CommandSpec, view: SurfaceView, opts: Record<string, unknown>): OptViolations {
  const iface = renderInterface(spec, view);
  const published = [...iface.required, ...iface.optional, ...(iface.addressing ?? [])];
  // `io` parameters are supplied by the MCP tool, not the agent, so they are
  // never the agent's obligation even when the schema requires them.
  const obligations = requiredNames(spec, view).filter((name) => publishedNames(spec, view).includes(name));
  const violations = diffViolations(published, obligations, opts);
  return { ...violations, missingCode: declaredMissingCode(spec, violations) };
}

/**
 * The same diff for a command group, against the selected variant.
 *
 * The discriminator is published as a parameter of every variant, so it counts
 * as supported and as required. With no variant selected the only thing the
 * caller can be told is that the selector is missing — reporting their content
 * parameters as unsupported would be misleading, since they may well be valid
 * for whichever type they meant.
 */
function groupViolations(
  group: CommandGroupSpec,
  variant: CommandSpec | undefined,
  view: SurfaceView,
  opts: Record<string, unknown>
): OptViolations {
  const iface = renderGroupInterface(group, view, variant ? variant.name : undefined);
  const published = [...iface.required, ...iface.optional, ...(iface.addressing ?? [])];

  if (!variant) {
    // Check if discriminator is present but wrong-typed
    const discriminatorValue = opts[group.discriminator];
    if (discriminatorValue !== undefined) {
      // Present but invalid: either wrong type or not in enum
      const validValues = [...group.variants.keys()];
      const expected = validValues.join('|');
      return {
        missing: [],
        unsupported: [],
        invalid: [{ name: group.discriminator, expected, received: receivedTypeLabel(discriminatorValue) }],
        exposed: [group.discriminator],
      };
    }
    // Absent
    return { missing: [group.discriminator], unsupported: [], invalid: [], exposed: [group.discriminator] };
  }

  const obligations = [group.discriminator, ...requiredNames(variant, view)];
  const violations = diffViolations(published, obligations, opts);
  return { ...violations, missingCode: declaredMissingCode(variant, violations) };
}

/**
 * The declared code for a missing parameter, if any missing one names a code.
 *
 * Preflight now enforces schema requiredness, so a requirement that used to be
 * reported by the runner is caught here instead. A published error code must not
 * change identity depending on which layer noticed the problem.
 *
 * A declared code wins over the generic one even when other parameters are also
 * missing, matching the precedence the runner had: its container-`id` guard ran
 * ahead of block-schema validation, so `CONTAINER_REQUIRES_ID` was reported for
 * a container that was missing other fields too. The message still lists every
 * problem, which the old early return did not.
 */
function declaredMissingCode(spec: CommandSpec, violations: OptViolations): string | undefined {
  const shape = spec.schema.shape as Record<string, z.ZodType>;
  for (const name of violations.missing) {
    const declared = shape[name] ? resolveParamPolicy(shape[name]!)?.missingCode : undefined;
    if (declared) {
      return declared;
    }
  }
  return undefined;
}

/** Render violations as a CLI-shaped outcome that points back at help. */
function violationOutcome(
  commandName: string,
  subcommand: string | undefined,
  { missing, unsupported, invalid, exposed, missingCode }: OptViolations
): CommandOutcome {
  const helpArgs = subcommand
    ? `{ command: "${commandName}", subcommand: "${subcommand}" }`
    : `{ command: "${commandName}" }`;
  const lines = [
    ...(missing.length > 0 ? [`missing required ${plural(missing.length, 'parameter')}: ${missing.join(', ')}`] : []),
    ...(unsupported.length > 0
      ? [
          `unsupported ${plural(unsupported.length, 'parameter')}: ${unsupported.join(
            ', '
          )} (not in the agent interface for this command)`,
        ]
      : []),
    ...(invalid.length > 0
      ? [
          `invalid ${plural(invalid.length, 'value')}: ${invalid
            .map((item) => `${item.name} expected ${item.expected}, received ${item.received}`)
            .join('; ')}`,
        ]
      : []),
    `Call pathfinder_help(${helpArgs}) for the parameters this command accepts.`,
  ];

  return {
    status: 'error',
    // Overreach alone is a different agent mistake than a malformed or
    // incomplete bag, so it gets a code the agent can branch on.
    code:
      missingCode ??
      (unsupported.length > 0 && missing.length === 0 && invalid.length === 0
        ? 'UNSUPPORTED_PARAMETER'
        : 'SCHEMA_VALIDATION'),
    message: `${commandName}: ${lines.join('. ')}`,
    data: {
      ...(missing.length > 0 ? { missing } : {}),
      ...(unsupported.length > 0 ? { unsupported } : {}),
      ...(invalid.length > 0 ? { invalid } : {}),
      exposed,
      command: commandName,
      ...(subcommand ? { subcommand } : {}),
    },
  };
}

/**
 * Preflight the agent-supplied `opts` bag against the same interface
 * `pathfinder_help` publishes.
 *
 * Returns `undefined` when the bag may be forwarded to the CLI runner, or a
 * rejection an MCP tool handler returns as-is. Every caller is a tool handler,
 * so the error envelope is built here rather than by a per-tool wrapper.
 *
 * Checks unknown command/subcommand, missing required parameters, blacklisted
 * or unpublished keys, and value types. Guide-content validation stays in the
 * imported runner.
 *
 * The subcommand is normally derived from `opts` (see `derivedSubcommand`);
 * pass one explicitly only for a tool that hardcodes it. A missing selector
 * falls back to the root command, which reports it as a missing required
 * parameter rather than an unknown subcommand.
 */
export function validateCommandArgs(
  commandName: string,
  opts: Record<string, unknown>,
  options: { subcommand?: string } = {}
): ToolResult | undefined {
  const outcome = commandArgViolations(commandName, opts, options);
  return outcome ? outcomeResult(outcome) : undefined;
}

/**
 * `validateCommandArgs` as a bare outcome rather than a tool envelope.
 *
 * A caller that wants to enrich the rejection — attaching the tree summary so a
 * rejected agent can still navigate, for instance — needs the outcome before it
 * is wrapped.
 */
export function commandArgViolations(
  commandName: string,
  opts: Record<string, unknown>,
  options: { subcommand?: string } = {}
): CommandOutcome | undefined {
  const subcommand = options.subcommand ?? derivedSubcommand(commandName, opts);
  const resolved = resolveCommandInterface(commandName, subcommand);
  if (isCommandInterfaceError(resolved)) {
    return resolved;
  }

  const view = agentView(commandName);
  const violations = resolved.group
    ? // Without a selector there is nothing to validate against but the
      // selector itself, which is exactly what the caller needs to be told.
      groupViolations(resolved.group, resolved.variant, view, opts)
    : specViolations(resolved.spec, view, opts);
  const clean =
    violations.missing.length === 0 && violations.unsupported.length === 0 && violations.invalid.length === 0;
  return clean ? undefined : violationOutcome(commandName, subcommand, violations);
}
