/**
 * Shared output formatter for the authoring CLI.
 *
 * Every authoring command produces a structured `CommandOutcome` and hands it
 * to `printOutcome()`, which renders it as text (default), one-line `--quiet`,
 * or `--format json`. Centralizing this formatter is what lets us promise a
 * stable JSON shape (consumed by the P3 MCP tool surface) without touching
 * every command when something changes.
 *
 * The text format is optimized for direct LLM consumption — terse, with
 * "what's next" hints. Quiet mode strips hints for known-workflow agents.
 * JSON mode is the wire format for `pathfinder_help` and the structured
 * mutation responses the MCP layer surfaces verbatim.
 */

import type { Command } from 'commander';
import { ZodError, z } from 'zod';

import { describeField, fieldNameToFlag, STRUCTURAL_SKIP_FIELDS } from './schema-options';
import type { PackageIOIssue } from './package-io';

// ---------------------------------------------------------------------------
// Output mode
// ---------------------------------------------------------------------------

export type OutputFormat = 'text' | 'json';

export interface OutputOptions {
  format: OutputFormat;
  quiet: boolean;
}

/**
 * Read `--format` and `--quiet` off any Commander command (or a parent in the
 * tree) and produce a single normalized `OutputOptions`. Walks `cmd.parent`
 * because we register the global flags on the root program, not on every
 * subcommand.
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

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

export interface SuccessOutcome {
  status: 'ok';
  /** Single-line summary used by --quiet mode. Should fit on one terminal line. */
  summary: string;
  /** Optional structured details rendered under the summary in text mode. */
  details?: Record<string, string | number | boolean | string[] | undefined>;
  /**
   * Optional multi-line block rendered after details (and before hints) in
   * text mode. Used for tree views and similar prose-shaped content where
   * `details` would force everything to a single line. JSON mode ignores
   * this field — consumers should read structured data from `data`.
   */
  text?: string;
  /** Optional next-step hints. Hidden in --quiet; rendered as bullets in text. */
  hints?: string[];
  /** Stable JSON-format payload. Authoritative when --format json is requested. */
  data?: Record<string, unknown>;
}

export interface ErrorOutcome {
  status: 'error';
  /** Stable error code, typically a `PackageIOErrorCode` or an MCP-shareable variant. */
  code: string;
  /** Human-readable message. */
  message: string;
  /** Additional structured detail per error (available IDs, conflicting fields, …). */
  data?: Record<string, unknown>;
}

export type CommandOutcome = SuccessOutcome | ErrorOutcome;

/**
 * Convert a `PackageIOError` payload into an `ErrorOutcome`. Used by every
 * mutator command in the catch-block; centralized here so the wire shape
 * stays consistent.
 */
export function issueToOutcome(issue: PackageIOIssue, data?: Record<string, unknown>): ErrorOutcome {
  return {
    status: 'error',
    code: issue.code,
    message: issue.message,
    data: data ?? (issue.path ? { path: issue.path } : undefined),
  };
}

/**
 * Render a single Zod issue as a one-line `<path>: <message>` string. Used to
 * keep error output prose-shaped instead of leaking raw `{origin, code, ...}`
 * JSON when Zod schemas reject mid-mutation.
 */
function formatZodIssue(issue: z.core.$ZodIssue): string {
  const path = issue.path
    .map((segment) => (typeof segment === 'number' ? `[${segment}]` : String(segment)))
    .filter((s) => s.length > 0)
    .join('.')
    .replace(/\.\[/g, '[');
  const where = path.length > 0 ? path : '<root>';
  return `${where}: ${issue.message}`;
}

/**
 * Render a thrown error from a CLI mutation into a clean prose string.
 *
 * Zod's default `.message` is a JSON-stringified issue array, which leaked
 * through to the user when a `.parse()` call inside a mutator failed.
 * Prefer the per-issue prettifier; fall back to the error's message text for
 * non-Zod errors.
 */
export function renderError(err: unknown): string {
  if (err instanceof ZodError) {
    return err.issues.map(formatZodIssue).join('; ');
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

/**
 * Render an outcome to stdout (success) or stderr (error) per the requested
 * format. Returns the process exit code: 0 on success, 1 on error.
 *
 * Commands should call this exactly once and use the returned value with
 * `process.exit()` so structured-output consumers see a clean stream.
 */
export function printOutcome(outcome: CommandOutcome, output: OutputOptions): number {
  if (output.format === 'json') {
    const stream = outcome.status === 'ok' ? process.stdout : process.stderr;
    stream.write(JSON.stringify(outcome, null, 2) + '\n');
    return outcome.status === 'ok' ? 0 : 1;
  }

  if (outcome.status === 'error') {
    process.stderr.write(formatErrorText(outcome) + '\n');
    return 1;
  }

  process.stdout.write(formatSuccessText(outcome, output.quiet) + '\n');
  return 0;
}

function formatSuccessText(outcome: SuccessOutcome, quiet: boolean): string {
  if (quiet) {
    return `ok ${outcome.summary}`;
  }
  const lines: string[] = [outcome.summary];
  if (outcome.details) {
    for (const [key, value] of Object.entries(outcome.details)) {
      if (value === undefined) {
        continue;
      }
      // `tree` is a list of pre-formatted lines from buildTree/renderTreeText
      // — render under a labeled block so each entry stays on its own line.
      // Other arrays use the inline comma-joined form.
      if (key === 'tree' && Array.isArray(value)) {
        lines.push(`  ${key}:`);
        for (const treeLine of value) {
          lines.push(`    ${treeLine}`);
        }
        continue;
      }
      lines.push(`  ${key}: ${formatDetailValue(value)}`);
    }
  }
  if (outcome.text && outcome.text.length > 0) {
    lines.push('');
    for (const textLine of outcome.text.split('\n')) {
      lines.push(textLine);
    }
  }
  if (outcome.hints && outcome.hints.length > 0) {
    lines.push('');
    for (const hint of outcome.hints) {
      lines.push(hint);
    }
  }
  return lines.join('\n');
}

function formatDetailValue(value: string | number | boolean | string[]): string {
  if (Array.isArray(value)) {
    return value.length === 0 ? '(none)' : value.join(', ');
  }
  return String(value);
}

function formatErrorText(outcome: ErrorOutcome): string {
  return `Error: ${outcome.message}`;
}

// ---------------------------------------------------------------------------
// Help-as-JSON contract
// ---------------------------------------------------------------------------

/**
 * Serialize a Commander command's surface into the stable JSON shape the
 * P3 MCP `pathfinder_help` tool will pass through verbatim.
 *
 * Top-level keys (`command`, `summary`, `required`, `optional`, `addressing`)
 * are stable. Per-flag entries have stable keys (`name`, `valueType`, `enum`,
 * `repeatable`, `description`, `default`). New keys may be added as additive
 * fields; existing keys are not renamed without a major version bump.
 *
 * See [docs/design/AGENT-AUTHORING.md#--help---format-json-is-a-stability-contract].
 */
export interface HelpJsonFlag {
  name: string;
  valueType: 'string' | 'number' | 'boolean' | 'enum' | 'array';
  enum?: readonly string[];
  repeatable?: boolean;
  description: string;
  default?: unknown;
}

export interface HelpJson {
  command: string;
  summary: string;
  required: HelpJsonFlag[];
  optional: HelpJsonFlag[];
  addressing?: HelpJsonFlag[];
  /** Subcommand names exposed by this command, if any. */
  subcommands?: string[];
}

const ADDRESSING_FLAGS: ReadonlySet<string> = new Set(['parent', 'branch', 'id', 'if-absent']);

export function formatHelpAsJson(cmd: Command): HelpJson {
  const required: HelpJsonFlag[] = [];
  const optional: HelpJsonFlag[] = [];
  const addressing: HelpJsonFlag[] = [];

  for (const option of cmd.options) {
    const flagName = (option.long ?? option.flags ?? '').replace(/^--/, '').split(/\s+/)[0] ?? '';
    if (!flagName) {
      continue;
    }
    if (STRUCTURAL_SKIP_FIELDS.has(flagName)) {
      continue;
    }
    const isBoolean = option.isBoolean();
    const isVariadic = option.variadic === true;
    const argChoices = (option as unknown as { argChoices?: string[] }).argChoices;
    let valueType: HelpJsonFlag['valueType'];
    if (isBoolean) {
      valueType = 'boolean';
    } else if (argChoices && argChoices.length > 0) {
      valueType = 'enum';
    } else if (isVariadic || Array.isArray(option.defaultValue)) {
      valueType = 'array';
    } else if (option.flags.includes('<number>')) {
      valueType = 'number';
    } else {
      valueType = 'string';
    }

    const flag: HelpJsonFlag = {
      name: flagName,
      valueType,
      description: option.description,
    };
    if (argChoices && argChoices.length > 0) {
      flag.enum = argChoices;
    }
    if (valueType === 'array') {
      flag.repeatable = true;
    }
    if (
      option.defaultValue !== undefined &&
      !(Array.isArray(option.defaultValue) && option.defaultValue.length === 0)
    ) {
      flag.default = option.defaultValue;
    }

    if (ADDRESSING_FLAGS.has(flagName)) {
      addressing.push(flag);
    } else if (option.mandatory) {
      required.push(flag);
    } else {
      optional.push(flag);
    }
  }

  const subcommands = cmd.commands.length > 0 ? cmd.commands.map((c) => c.name()) : undefined;

  const result: HelpJson = {
    command: cmd.name(),
    summary: cmd.description() ?? '',
    required,
    optional,
  };
  if (addressing.length > 0) {
    result.addressing = addressing;
  }
  if (subcommands && subcommands.length > 0) {
    result.subcommands = subcommands;
  }
  return result;
}

// Pin the bridge imports as observed contract so unused-import drift
// surfaces during refactoring rather than silently breaking the help shape.
void describeField;
void fieldNameToFlag;
