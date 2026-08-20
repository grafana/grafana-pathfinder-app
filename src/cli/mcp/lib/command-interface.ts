/**
 * Agent-facing translation over the Commander command registry.
 *
 * Sits between `pathfinder_help` and the agent for *any* CLI command. Commander
 * owns the option surface; this module republishes it under the attribute names
 * imported runners actually receive, minus parameters an MCP tool has taken
 * over or cannot honor.
 *
 * The translation is subtractive on purpose: a command with no binding config
 * exposes its full surface, so new CLI capability reaches agents without a
 * change here. MCP tool modules register their own exclusions and contextual
 * annotations next to the tool binding that requires them.
 *
 * Two entry points, both driven by the same projection: `formatCommandInterface`
 * publishes the interface, `validateCommandArgs` holds an invocation to it.
 */

import type { Argument, Command, Option } from 'commander';

import { formatHelpAsJson, type CommandOutcome, type HelpJson, type HelpJsonFlag } from '../../utils/output';
import { CLI_COMMANDS } from '../program';
import { outcomeResult, type ToolResult } from '../tools/result';

// ----------------- binding config -----------------

export interface CommandInterfaceConfig {
  /** Commander attribute/argument names omitted from agent help and rejected at invocation. */
  optBlacklist?: readonly string[];
  /**
   * Synthetic required option that selects a Commander subcommand. `add-block`
   * uses `type`, whose enum values are derived from registered subcommands.
   */
  subcommandOpt?: string;
}

const COMMAND_INTERFACE_CONFIG = new Map<string, CommandInterfaceConfig>();

/**
 * Bind MCP-specific interface policy next to the MCP tool that owns it.
 */
export function registerCommandInterfaceConfig(commandName: string, config: CommandInterfaceConfig): void {
  COMMAND_INTERFACE_CONFIG.set(commandName, config);
}

/** CLI command names that currently have an MCP binding. */
export function registeredCommandInterfaceNames(): ReadonlySet<string> {
  return new Set(COMMAND_INTERFACE_CONFIG.keys());
}

// ----------------- command resolution -----------------

export interface CommandInterfaceError {
  status: 'error';
  code: 'UNKNOWN_COMMAND' | 'UNKNOWN_SUBCOMMAND';
  message: string;
}

/** A Commander command paired with the binding policy that shapes it. */
interface ResolvedCommand {
  root: Command;
  command: Command;
  config: CommandInterfaceConfig;
}

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

/** Look up a command, optionally descending into one of its subcommands. */
function resolveCommandInterface(commandName: string, subcommand?: string): ResolvedCommand | CommandInterfaceError {
  const root = CLI_COMMANDS.get(commandName);
  if (!root) {
    return {
      status: 'error',
      code: 'UNKNOWN_COMMAND',
      message: `Unknown command "${commandName}". Available: ${[...CLI_COMMANDS.keys()].join(', ')}`,
    };
  }

  const config = COMMAND_INTERFACE_CONFIG.get(commandName) ?? {};
  if (!subcommand) {
    return { root, command: root, config };
  }

  const command = root.commands.find((candidate) => candidate.name() === subcommand);
  if (!command) {
    return {
      status: 'error',
      code: 'UNKNOWN_SUBCOMMAND',
      message: `Unknown ${commandName} subcommand "${subcommand}". Available: ${root.commands
        .map((candidate) => candidate.name())
        .join(', ')}`,
    };
  }

  return { root, command, config };
}

// ----------------- interface projection -----------------

/** An option's `--long-flag` name, which is how help output keys it. */
function optionCliName(option: Option): string {
  return (option.long ?? option.flags).replace(/^--/, '').split(/\s+/)[0] ?? '';
}

/** Options the agent is allowed to set: visible to Commander, not blacklisted. */
function exposedOptions(command: Command, config: CommandInterfaceConfig): Option[] {
  const blacklist = config.optBlacklist ?? [];
  return command.options.filter((option) => option.hidden !== true && !blacklist.includes(option.attributeName()));
}

/** Exposed options keyed for joining against `formatHelpAsJson` output. */
function exposedOptionsByCliName(command: Command, config: CommandInterfaceConfig): ReadonlyMap<string, Option> {
  return new Map(exposedOptions(command, config).map((option) => [optionCliName(option), option]));
}

/** Positional arguments the agent supplies as ordinary named opts. */
function exposedArguments(command: Command, config: CommandInterfaceConfig): Argument[] {
  const blacklist = config.optBlacklist ?? [];
  return command.registeredArguments.filter((argument) => !blacklist.includes(argument.name()));
}

/** Rekey help flags to attribute names, dropping any the binding filtered out. */
function translateFlags(
  flags: HelpJsonFlag[],
  optionsByCliName: ReadonlyMap<string, Option>,
  config: CommandInterfaceConfig
): HelpJsonFlag[] {
  return flags.flatMap((flag) => {
    const option = optionsByCliName.get(flag.name);
    if (!option) {
      return [];
    }
    // Commander's own conversion — the key a runner reads out of `opts()`.
    return [{ ...flag, name: option.attributeName() }];
  });
}

/**
 * JSON help omits STRUCTURAL_SKIP_FIELDS (`type`, `blocks`, …) even when a
 * command hand-registers a flag of that name. `create --type` is the live
 * case: a package-type enum, not a block discriminator. Publish any exposed
 * Commander option the serializer dropped so the agent can still set it.
 */
function optionToHelpFlag(option: Option): HelpJsonFlag {
  const isBoolean = option.isBoolean();
  const isVariadic = option.variadic === true;
  const argChoices = (option as unknown as { argChoices?: string[] }).argChoices;
  let valueType: HelpJsonFlag['valueType'];
  if (isBoolean) {
    valueType = 'boolean';
  } else if (isVariadic || Array.isArray(option.defaultValue)) {
    valueType = 'array';
  } else if (argChoices && argChoices.length > 0) {
    valueType = 'enum';
  } else if (option.flags.includes('<number>')) {
    valueType = 'number';
  } else {
    valueType = 'string';
  }
  return {
    name: option.attributeName(),
    valueType,
    description: option.description,
    ...(argChoices && argChoices.length > 0 ? { enum: argChoices } : {}),
    ...(valueType === 'array' ? { repeatable: true } : {}),
    ...(option.defaultValue !== undefined && !(Array.isArray(option.defaultValue) && option.defaultValue.length === 0)
      ? { default: option.defaultValue }
      : {}),
  };
}

/** Publish a positional argument as if it were an ordinary opt. */
function argumentToHelpFlag(argument: Argument): HelpJsonFlag {
  const choices = argument.argChoices;
  const valueType: HelpJsonFlag['valueType'] =
    choices && choices.length > 0 ? 'enum' : argument.variadic ? 'array' : 'string';
  return {
    name: argument.name(),
    valueType,
    description: argument.description,
    ...(choices && choices.length > 0 ? { enum: choices } : {}),
    ...(argument.variadic ? { repeatable: true } : {}),
    ...(argument.defaultValue !== undefined ? { default: argument.defaultValue } : {}),
  };
}

/** Synthesize the enum opt that picks a subcommand, when one is configured. */
function subcommandSelector(root: Command, config: CommandInterfaceConfig): HelpJsonFlag | undefined {
  if (!config.subcommandOpt || root.commands.length === 0) {
    return undefined;
  }
  return {
    name: config.subcommandOpt,
    valueType: 'enum',
    enum: root.commands.map((command) => command.name()),
    description: `Selects the ${root.name()} subcommand.`,
  };
}

/** The complete agent-facing opt set — the contract both entry points share. */
function publishedOpts(resolved: ResolvedCommand): {
  base: HelpJson;
  required: HelpJsonFlag[];
  optional: HelpJsonFlag[];
  addressing: HelpJsonFlag[];
} {
  const base = formatHelpAsJson(resolved.command);
  const optionsByCliName = exposedOptionsByCliName(resolved.command, resolved.config);
  const required = translateFlags(base.required, optionsByCliName, resolved.config);
  const optional = translateFlags(base.optional, optionsByCliName, resolved.config);
  const addressing = translateFlags(base.addressing ?? [], optionsByCliName, resolved.config);

  for (const argument of exposedArguments(resolved.command, resolved.config)) {
    (argument.required ? required : optional).push(argumentToHelpFlag(argument));
  }
  const selector = subcommandSelector(resolved.root, resolved.config);
  if (selector) {
    required.unshift(selector);
  }

  const publishedNames = new Set([...required, ...optional, ...addressing].map((flag) => flag.name));
  for (const option of exposedOptions(resolved.command, resolved.config)) {
    const name = option.attributeName();
    if (publishedNames.has(name)) {
      continue;
    }
    (option.mandatory ? required : optional).push(optionToHelpFlag(option));
    publishedNames.add(name);
  }

  return { base, required, optional, addressing };
}

/** Rekey the per-subcommand required-flag index to attribute names. */
function translateRequiredByType(
  resolved: ResolvedCommand,
  requiredByType: Record<string, string[]>
): Record<string, string[]> {
  const translated: Record<string, string[]> = {};
  for (const [type, cliNames] of Object.entries(requiredByType)) {
    const child = resolved.command.commands.find((candidate) => candidate.name() === type);
    if (!child) {
      continue;
    }
    const childOptions = exposedOptionsByCliName(child, resolved.config);
    translated[type] = cliNames.flatMap((cliName) => {
      const option = childOptions.get(cliName);
      return option ? [option.attributeName()] : [];
    });
  }
  return translated;
}

/**
 * Republish a CLI command's help under the agent-facing parameter interface.
 *
 * Descriptions, requiredness, value types, choices, and defaults stay exactly
 * as the CLI serializer produced them.
 */
export function formatCommandInterface(commandName: string, subcommand?: string): HelpJson | CommandInterfaceError {
  const resolved = resolveCommandInterface(commandName, subcommand);
  if (isCommandInterfaceError(resolved)) {
    return resolved;
  }

  const { base, required, optional, addressing } = publishedOpts(resolved);
  const result: HelpJson = { ...base, required, optional };

  if (addressing.length > 0) {
    result.addressing = addressing;
  } else {
    delete result.addressing;
  }
  if (base.requiredByType) {
    result.requiredByType = translateRequiredByType(resolved, base.requiredByType);
  }

  return result;
}

// ----------------- argument validation -----------------

interface OptViolations {
  missing: string[];
  unsupported: string[];
  invalid: Array<{ name: string; expected: string; received: string }>;
  /** Every opt name the interface publishes, echoed back to orient the agent. */
  exposed: string[];
}

/** The subcommand the agent's own opts imply, per the binding config. */
function derivedSubcommand(commandName: string, opts: Record<string, unknown>): string | undefined {
  const selector = COMMAND_INTERFACE_CONFIG.get(commandName)?.subcommandOpt;
  const selected = selector ? opts[selector] : undefined;
  return typeof selected === 'string' && selected !== '' ? selected : undefined;
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
    default:
      return typeof value === 'string';
  }
}

function expectedTypeLabel(flag: HelpJsonFlag): string {
  if (flag.valueType === 'enum') {
    return flag.enum?.join('|') ?? 'enum';
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

/** Diff the agent's bag against the published interface. */
function commandViolations(resolved: ResolvedCommand, opts: Record<string, unknown>): OptViolations {
  // MCP reaches the runners without going through Commander's parser, so the
  // guarantees the parser would have enforced are replicated here: required
  // positionals, a configured subcommand selector, and options Commander marks
  // mandatory. Commands that defer required-field reporting to a single Zod
  // pass (`forceOptional`, notably add-block) register no mandatory options, so
  // their multi-error reporting still belongs to the runner.
  const requiredBeforeRunner = [
    ...exposedArguments(resolved.command, resolved.config)
      .filter((argument) => argument.required)
      .map((argument) => argument.name()),
    ...exposedOptions(resolved.command, resolved.config)
      .filter((option) => option.mandatory)
      .map((option) => option.attributeName()),
    ...(resolved.config.subcommandOpt ? [resolved.config.subcommandOpt] : []),
  ];

  const { required, optional, addressing } = publishedOpts(resolved);
  const published = [...required, ...optional, ...addressing];
  const exposed = [...new Set(published.map((flag) => flag.name))].sort();
  const exposedSet = new Set(exposed);

  return {
    missing: requiredBeforeRunner.filter((name) => opts[name] === undefined || opts[name] === ''),
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

/** Render violations as a CLI-shaped outcome that points back at help. */
function violationOutcome(
  commandName: string,
  subcommand: string | undefined,
  { missing, unsupported, invalid, exposed }: OptViolations
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
      unsupported.length > 0 && missing.length === 0 && invalid.length === 0
        ? 'UNSUPPORTED_PARAMETER'
        : 'SCHEMA_VALIDATION',
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
  const subcommand = options.subcommand ?? derivedSubcommand(commandName, opts);
  const resolved = resolveCommandInterface(commandName, subcommand);
  if (isCommandInterfaceError(resolved)) {
    return outcomeResult(resolved);
  }

  const violations = commandViolations(resolved, opts);
  const clean =
    violations.missing.length === 0 && violations.unsupported.length === 0 && violations.invalid.length === 0;
  return clean ? undefined : outcomeResult(violationOutcome(commandName, subcommand, violations));
}
