/**
 * The Commander adapter.
 *
 * Renders a `CommandSpec` into a Commander `Command`, and provides the one
 * generic action handler that replaces the per-command `.action()` bodies.
 * Commander's job here is narrow: turn text a human typed into the shape the
 * schema declares, then get out of the way.
 *
 * Everything this module decides is presentation: which fields a caller types as
 * positional arguments, how a camelCase name is spelled as a flag, what a value
 * is called in help, whether a field appears in help at all. None of it is true
 * of the command — it is true of a command line — so none of it is on the schema.
 */

import { Command, Option } from 'commander';
import type { z } from 'zod';

import { describeField, fieldNameToFlag } from '../utils/schema-options';
import { printOutcome, type ErrorOutcome, type OutputFormat, type OutputOptions } from '../utils/output';
import { spellOutcome, spellParams, type ParamSpelling } from '../utils/param-spelling';
import { zodDefaultValue } from '../utils/zod-internals';
import { buildOptionForField } from './commander-options';
import { requiredByVariant, type CommandGroupSpec } from './group';
import { outcomeFromZodError } from './outcome';
import {
  carriesRequirementTokens,
  describeFor,
  REQUIREMENT_TOKEN_EXAMPLES,
  type SurfaceView,
} from './render-interface';
import { specFields, type CommandSpec, type SpecField } from './spec';

/**
 * How a command line sees a command, for `--help --format json`. Everything is
 * published, because an operator can set everything a command declares — `io`
 * plumbing included — and every name is spelled the way it is typed.
 */
export const CLI_VIEW: SurfaceView = {
  name: (field) => fieldNameToFlag(field.name),
  publishes: () => true,
  spell: (name) => `--${fieldNameToFlag(name)}`,
  // An operator can run the command that prints the vocabulary, so they are told to.
  describe: (field, stated) =>
    carriesRequirementTokens(field.name)
      ? `${stated} | run "pathfinder-cli requirements list" for valid tokens (e.g., ${REQUIREMENT_TOKEN_EXAMPLES})`
      : stated,
};

/**
 * How one command reads as a command line. Every entry names schema fields, and
 * is checked against the schema at mount time — module load — so a rename that
 * misses its presentation fails immediately.
 */
export interface CommanderPresentation {
  /** Fields a caller types as positional arguments, in usage order. */
  positionals?: readonly string[];
  /**
   * Value names in help: `{ at: 'jsonpath' }` prints `--at <jsonpath>`. A trailing
   * `...` is Commander's own spelling for "repeat the value after one flag", so
   * `{ exclude: 'paths...' }` prints `--exclude <paths...>` and parses as variadic.
   * Applies to positionals too.
   */
  placeholders?: Readonly<Record<string, string>>;
  /** Fields omitted from text help but still parseable. Says nothing about who may set them. */
  hidden?: readonly string[];
  /**
   * Fields this command line does not accept as flags at all. For a value the adapter
   * supplies instead — see `inherits` — where registering a local flag would be
   * redundant and would change how the command reads in its parent's listing.
   */
  omitted?: readonly string[];
  /** Single-letter aliases: `{ output: 'o' }` prints `-o, --output <file>`. */
  shorts?: Readonly<Record<string, string>>;
  /**
   * Per-field override of whether help prints the declared default. Booleans default
   * to hiding a `false` (absence already means false) and everything else to showing
   * what it declares; a command line that has always read the other way says so here,
   * since help text is what scripts and docs quote.
   */
  showDefaults?: Readonly<Record<string, boolean>>;
  /**
   * Off-switches for booleans that default to true, mapped to their help text:
   * `{ lint: 'Suppress lint output' }` adds `--no-lint`. Commander needs the negation
   * spelled out as its own flag; the schema sees one field either way.
   */
  negatable?: Readonly<Record<string, string>>;
  /**
   * Fields that fall back to the root program's option of the same name when this
   * command does not set one. Only the output options are global, and only a command
   * that redeclares one locally needs this — Commander gives the child's value
   * precedence, including the child's own default, which would shadow the root.
   */
  inherits?: ReadonlyArray<'format' | 'quiet'>;
}

const NO_PRESENTATION: CommanderPresentation = {};

/**
 * Read `--format` and `--quiet` off a command or any parent, since the global flags
 * live on the root program rather than on every subcommand. A parent's value wins:
 * `pathfinder-cli --format json <cmd>` is the documented spelling, and a subcommand
 * that redeclares the flag would otherwise shadow it with its own default.
 */
export function readOutputOptions(cmd: Command): OutputOptions {
  let cursor: Command | null = cmd;
  let format: OutputFormat = 'text';
  let quiet = false;
  while (cursor) {
    const opts = cursor.opts() as { format?: string; quiet?: boolean };
    if (opts.format === 'json' || opts.format === 'text') {
      format = opts.format;
    }
    if (opts.quiet) {
      quiet = true;
    }
    cursor = cursor.parent ?? null;
  }
  return { format, quiet };
}

interface CommanderFields {
  positionals: SpecField[];
  options: SpecField[];
}

/** Check a presentation against the schema it describes, then split the fields. */
function commanderFields(spec: CommandSpec, presentation: CommanderPresentation): CommanderFields {
  const fields = specFields(spec);
  const known = new Map(fields.map((entry) => [entry.name, entry]));

  const named = [
    ...(presentation.positionals ?? []),
    ...Object.keys(presentation.placeholders ?? {}),
    ...(presentation.hidden ?? []),
    ...(presentation.omitted ?? []),
    ...Object.keys(presentation.showDefaults ?? {}),
    ...Object.keys(presentation.shorts ?? {}),
    ...Object.keys(presentation.negatable ?? {}),
    ...(presentation.inherits ?? []),
  ];
  const unknown = named.filter((name) => !known.has(name));
  if (unknown.length > 0) {
    throw new Error(
      `Command "${spec.name}": Commander presentation names no such field(s): ${[...new Set(unknown)].join(', ')}. ` +
        `Declared: ${[...known.keys()].join(', ')}`
    );
  }

  const positionals = presentation.positionals ?? [];
  const duplicated = positionals.filter((name, index) => positionals.indexOf(name) !== index);
  if (duplicated.length > 0) {
    throw new Error(`Command "${spec.name}": duplicate positional(s): ${[...new Set(duplicated)].join(', ')}.`);
  }

  const notAnOption = new Set([...positionals, ...(presentation.omitted ?? [])]);
  return {
    positionals: positionals.map((name) => known.get(name)!),
    options: fields.filter((entry) => !notAnOption.has(entry.name)),
  };
}

/**
 * Assemble the raw input object from Commander's two channels.
 *
 * Commander stores option values under the camelCase attribute name derived
 * from the long flag (`--show-me` → `showMe`), which is the field name the
 * schema declared, so options forward by identity. Positionals arrive as
 * ordered action arguments and are keyed back onto their field names — the
 * point at which positional-ness stops being observable.
 *
 * Default-sourced values are dropped. Commander populates every option it holds a
 * default for, which erases the difference between "the user asked for false" and
 * "the user said nothing" — the distinction `set-manifest` needs in order to patch
 * rather than overwrite. Dropping them leaves Commander's default as display only,
 * and the schema as the one thing that applies one.
 */
export function collectCommanderInput(
  positionals: readonly string[],
  positionalValues: readonly unknown[],
  optionValues: Record<string, unknown>,
  optionSource: (name: string) => string | undefined = () => 'cli'
): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(optionValues)) {
    if (optionSource(name) !== 'default') {
      raw[name] = value;
    }
  }
  positionals.forEach((name, index) => {
    raw[name] = positionalValues[index];
  });
  return raw;
}

/**
 * Parse a raw input bag against the spec's schema.
 *
 * Shared by both adapters — the MCP adapter calls it with the agent payload,
 * this module calls it with Commander's output. One validation contract, two
 * pre-processors.
 */
export function parseCommandInput<S extends z.ZodObject>(
  spec: CommandSpec<S>,
  raw: Record<string, unknown>
): { ok: true; value: z.output<S> } | { ok: false; outcome: ErrorOutcome } {
  const parsed = spec.schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, outcome: outcomeFromZodError(spec, parsed.error, raw) };
  }
  return { ok: true, value: parsed.data as z.output<S> };
}

/**
 * How this command line spells a parameter: `dir` if it is typed as an argument,
 * `--target-url-prefix` if it is typed as a flag. Presentation-aware, unlike
 * `CLI_VIEW.spell`, which has no way to know which fields are positional.
 */
function cliSpelling(presentation: CommanderPresentation): ParamSpelling {
  const positionals = new Set(presentation.positionals ?? []);
  return (name) => (positionals.has(name) ? name : `--${fieldNameToFlag(name)}`);
}

/**
 * A schema failure as Commander would have reported it, or `null` if Commander has no
 * phrasing for it.
 *
 * The schema is the only validator — `option.mandatory` stays off so every problem is
 * reported at once — but a command line has said "required option '--x' not
 * specified" for as long as there have been command lines, and scripts read stderr.
 * So the failure is raised once and dressed here, at the surface that has an idiom,
 * rather than in the runner that has a contract. `--format json` gets the structured
 * outcome instead: the reader that asked for machine output is not this one.
 */
function commanderSentence(
  spec: CommandSpec,
  presentation: CommanderPresentation,
  outcome: ErrorOutcome,
  raw: Record<string, unknown>
): string | null {
  const issues = (outcome.data as { issues?: Array<{ path: string; message: string }> } | undefined)?.issues ?? [];
  const fields = new Map(specFields(spec).map((entry) => [entry.name, entry]));
  const positionals = new Set(presentation.positionals ?? []);

  for (const issue of issues) {
    const [name, ...rest] = issue.path.split('.');
    const entry = name ? fields.get(name) : undefined;
    // Commander never reports a positional this way — it refuses missing arguments
    // itself, before any of this runs.
    if (!entry || positionals.has(entry.name)) {
      continue;
    }
    const flags = optionForField(entry, presentation)?.flags;
    if (!flags) {
      continue;
    }
    if (raw[entry.name] === undefined) {
      // A parameter that states why it is required says it better than Commander's
      // generic line, and the outcome already carries that sentence.
      return entry.policy.missingMessage ? null : `error: required option '${flags}' not specified`;
    }
    // Commander reports a value it parsed but cannot accept by naming the flag, the
    // value, and why — `Allowed choices are …` when the parameter is a vocabulary,
    // and otherwise whatever the schema said, which is the part it has no phrasing of
    // its own for.
    const shape = describeField(entry.field);
    const supplied = rest.reduce<unknown>(
      (value, key) => (Array.isArray(value) ? value[Number(key)] : undefined),
      raw[entry.name]
    );
    const reason =
      shape.kind === 'enum' || shape.kind === 'array-enum'
        ? `Allowed choices are ${shape.values.join(', ')}.`
        : issue.message;
    return `error: option '${flags}' argument '${String(supplied)}' is invalid. ${reason}`;
  }
  return null;
}

/** `<name>` for a required positional, `[name]` for an optional one. */
function positionalToken(entry: SpecField, presentation: CommanderPresentation): string {
  const token = presentation.placeholders?.[entry.name] ?? entry.name;
  return describeField(entry.field).optional ? `[${token}]` : `<${token}>`;
}

/**
 * Does printing this default tell a reader anything? Two say nothing and mislead:
 * `false` on a flag whose absence already means false, and `[]` on a repeatable one,
 * which reads as though a literal `[]` could be passed.
 */
function isDefaultWorthPrinting(option: Option, value: unknown): boolean {
  if (option.isBoolean()) {
    return value === true;
  }
  return !(Array.isArray(value) && value.length === 0);
}

function optionForField(entry: SpecField, presentation: CommanderPresentation): Option | null {
  const option = buildOptionForField(entry.name, entry.field, {
    placeholder: presentation.placeholders?.[entry.name],
    short: presentation.shorts?.[entry.name],
    description: describeFor(entry, CLI_VIEW),
  });
  if (!option) {
    return null;
  }
  if (presentation.hidden?.includes(entry.name)) {
    option.hideHelp();
  }

  // Requiredness is the schema's to enforce, never Commander's: its parser rejects
  // the *first* missing mandatory option and exits, so an author missing three
  // fields learns about them one round-trip at a time, where `safeParse` reports
  // all three at once. Commander's *phrasing* is kept for text output —
  // `commanderSentence` — so the enforcement moves without the idiom moving with it.
  option.mandatory = false;

  // Display only — `collectCommanderInput` drops whatever Commander fills in.
  const fallback = zodDefaultValue(entry.field);
  const shows = presentation.showDefaults?.[entry.name] ?? isDefaultWorthPrinting(option, fallback.value);
  if (fallback.present && shows) {
    option.default(fallback.value);
  }
  return option;
}

/**
 * Render a spec as a Commander command.
 *
 * Registration order is arguments-then-options, matching how Commander renders
 * help, so a generated command's help text is indistinguishable from the
 * hand-written declaration it replaces.
 */
export function mountCommander(spec: CommandSpec, presentation: CommanderPresentation = NO_PRESENTATION): Command {
  const command = new Command(spec.name).description(spec.summary);
  const { positionals, options } = commanderFields(spec, presentation);

  for (const entry of positionals) {
    command.argument(positionalToken(entry, presentation), describeField(entry.field).description ?? '');
  }

  for (const entry of options) {
    const option = optionForField(entry, presentation);
    if (option) {
      command.addOption(option);
    }
    const negation = presentation.negatable?.[entry.name];
    if (negation) {
      command.addOption(new Option(`--no-${fieldNameToFlag(entry.name)}`, negation));
    }
  }

  const positionalNames = positionals.map((entry) => entry.name);

  command.action(async function (this: Command, ...args: unknown[]) {
    // Commander invokes the handler with (…positionals, options, command).
    const positionalValues = args.slice(0, positionals.length);
    const output = readOutputOptions(this);

    const raw = collectCommanderInput(positionalNames, positionalValues, this.opts(), (name) =>
      this.getOptionValueSource(name)
    );
    for (const name of presentation.inherits ?? []) {
      raw[name] ??= output[name];
    }
    // Everything printed below goes through this: a runner states parameter
    // references, and this command line is the only thing that knows whether one is
    // typed as `--id` or as a bare argument.
    const spell = cliSpelling(presentation);

    const parsed = parseCommandInput(spec, raw);
    if (!parsed.ok) {
      const sentence = output.format === 'text' ? commanderSentence(spec, presentation, parsed.outcome, raw) : null;
      if (sentence) {
        // Commander's own exit: stderr, code 1, and `exitOverride` still honoured.
        this.error(spellParams(sentence, spell));
      }
      process.exit(printOutcome(spellOutcome(parsed.outcome, spell), output));
    }
    const outcome = await spec.run(parsed.value);

    // A streaming command has already written everything it means to say, in the shape
    // its consumers parse, and may still own the process — `mcp` serves until it is
    // signalled — so the adapter adds nothing on success and only forces the failing
    // exit code.
    if (spec.emits === 'stream') {
      if (outcome.status !== 'ok') {
        process.exit(1);
      }
      return;
    }

    // An exporting command's stdout is the document, in either output format:
    // `--format json` selects how a *report* is rendered, and this is not one.
    // Failures still report as outcomes, since there is no document to write.
    if (spec.emits === 'artifact' && outcome.status === 'ok') {
      process.stdout.write(JSON.stringify(outcome.artifact, null, 2) + '\n');
      process.exit(0);
    }

    process.exit(printOutcome(spellOutcome(outcome, spell), output));
  });

  return command;
}

/**
 * Render a group as a root command with one subcommand per variant. The presentation
 * applies to all of them: `add-block markdown <dir>` and `add-block table <dir>` are one
 * command line with a different type, and it would be a bug for them to differ.
 */
export function mountCommanderGroup(group: CommandGroupSpec, presentation: CommanderPresentation = {}): Command {
  const root = new Command(group.name).description(groupDescription(group, presentation));
  for (const spec of group.variants.values()) {
    root.addCommand(mountCommander(spec, presentation));
  }
  return root;
}

/**
 * Root text-help description, with the per-variant requirement table appended.
 * Without it, authoring one block type costs two help round-trips: the root
 * listing, then the per-type help. Commander-only — agents get `requiredByType`
 * as structured data.
 *
 * `requiredByVariant(group, CLI_VIEW)` already names each flag the way this
 * command line spells it — kebab-cased, via `CLI_VIEW.name` — so this only
 * drops the positionals, which the usage line has already covered (`<dir>`
 * printed once by `positionalToken`, calling it `--dir` too would be wrong).
 * A group whose variants take no flags at all gets no table, since every row
 * would read `(none)`.
 */
function groupDescription(group: CommandGroupSpec, presentation: CommanderPresentation): string {
  const table = requiredByVariant(group, CLI_VIEW);
  const positionalFlags = new Set((presentation.positionals ?? []).map(fieldNameToFlag));
  const flagsFor = (name: string) => (table[name] ?? []).filter((flag) => !positionalFlags.has(flag));
  if (Object.keys(table).every((name) => flagsFor(name).length === 0)) {
    return group.summary;
  }
  const width = Math.max(...Object.keys(table).map((name) => name.length));
  const lines = ['', `Required flags by type (run \`${group.name} <type> --help\` for the full surface):`];
  for (const name of Object.keys(table).sort()) {
    const flags = flagsFor(name);
    const spelled = flags.map((flag) => `--${flag}`).join(' ');
    lines.push(`  ${name.padEnd(width)}  ${flags.length === 0 ? '(none)' : spelled}`);
  }
  return `${group.summary}\n${lines.join('\n')}`;
}
