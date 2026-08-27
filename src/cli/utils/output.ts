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

import { ZodError, z } from 'zod';

import type { IssueRemedy, PackageIOIssue } from './package-io';
import { CLI_SPELLING, spellOutcome } from './param-spelling';

// ---------------------------------------------------------------------------
// Output mode
// ---------------------------------------------------------------------------

export type OutputFormat = 'text' | 'json';

export interface OutputOptions {
  format: OutputFormat;
  quiet: boolean;
}

/**
 * Serialize a machine-facing payload (MCP tool results, CLI `--format json`)
 * as compact JSON. Pretty-print indentation is pure token overhead for an
 * agent consumer; output stays valid JSON that existing JSON.parse consumers
 * read unchanged. Human-read output (CLI text mode) and on-disk build
 * artifacts keep prettier formatting via formatJsonWithPrettier.
 */
export function renderMachineJson(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * Prettier-format a JSON string with the repo config, ensuring a trailing
 * newline. Shared by the build-* commands that write generated JSON to disk.
 */
export async function formatJsonWithPrettier(json: string): Promise<string> {
  // `prettier` is a devDependency and is absent from RUNTIME_DEPS, so it does
  // not exist in the published CLI image. Degrade to the caller's own JSON
  // rather than failing: the output is still valid, just unformatted, and the
  // alternative is a documented CI gate a content repo cannot satisfy from the
  // image it is told to use.
  let prettier: typeof import('prettier');
  try {
    prettier = await import('prettier');
  } catch {
    return json.endsWith('\n') ? json : `${json}\n`;
  }
  const config = await prettier.resolveConfig(process.cwd());
  const formatted = await prettier.format(json, { ...(config ?? {}), parser: 'json' });
  return formatted.endsWith('\n') ? formatted : `${formatted}\n`;
}

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

/**
 * Soft hint attached to a successful outcome. Used for non-fatal feedback the
 * caller (CLI user or MCP-driven agent) should consider but not retry on.
 * The MCP layer surfaces these verbatim; the CLI renders them in text and
 * JSON output. Codes are stable strings — see `docs/developer/MCP_SERVER.md`
 * for the registry of well-known codes.
 */
export interface OutcomeWarning {
  /** Stable warning code, e.g. `UNVERIFIED_SELECTOR`, `MULTISTEP_COMPOSITION_HINT`. */
  code: string;
  /** Human-readable message describing the concern and what to do about it. */
  message: string;
  /** Optional dotted/bracketed path locating the field the warning is about. */
  path?: string;
}

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
  /**
   * Optional soft-feedback entries (M2 — see
   * `docs/design/MCP-AGENT-UX-HARDENING.md`). Rendered as a `Warnings:` block
   * in text mode (suppressed in --quiet), and serialized verbatim in JSON
   * mode so MCP callers see the same structured payload.
   */
  warnings?: OutcomeWarning[];
  /** Optional next-step hints. Hidden in --quiet; rendered as bullets in text. */
  hints?: string[];
  /** Stable JSON-format payload. Authoritative when --format json is requested. */
  data?: Record<string, unknown>;
  /**
   * The exported document, for a command that emits one (`emits: 'artifact'`). Separate
   * from `data` because it is not a report *about* the command but the thing the caller
   * asked for, written to stdout verbatim so it can be redirected to a file.
   */
  artifact?: unknown;
}

export interface ErrorOutcome {
  status: 'error';
  /** Stable error code, typically a `PackageIOErrorCode` or an MCP-shareable variant. */
  code: string;
  /** Human-readable message. */
  message: string;
  /** Additional structured detail per error (available IDs, conflicting fields, …). */
  data?: Record<string, unknown>;
  /** The command that fixes this, named rather than spelled. Renders only on the CLI. */
  remedy?: IssueRemedy;
  /** Optional process exit code for commands that distinguish failure types */
  exitCode?: number;
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
    ...(issue.remedy ? { remedy: issue.remedy } : {}),
  };
}

/**
 * Build a multi-issue `SCHEMA_VALIDATION` error outcome from a list of Zod
 * issues. When more than one issue is present, the message lists each on its
 * own line so the agent sees every required-field violation in a single
 * round-trip (instead of fixing one and discovering the next on retry).
 *
 * `subject` should be a short label like `"interactive block"` or
 * `"manifest"` used in the header line.
 */
export function manyIssuesOutcome(
  issues: ReadonlyArray<{ path?: readonly PropertyKey[] | undefined; message: string }>,
  subject: string
): ErrorOutcome {
  if (issues.length === 0) {
    return {
      status: 'error',
      code: 'SCHEMA_VALIDATION',
      message: `Validation failed for ${subject}`,
    };
  }
  const formatPath = (path: readonly PropertyKey[] | undefined): string => {
    if (!path || path.length === 0) {
      return '<root>';
    }
    return (
      path
        .map((segment) => (typeof segment === 'number' ? `[${segment}]` : String(segment)))
        .filter((s) => s.length > 0)
        .join('.')
        .replace(/\.\[/g, '[') || '<root>'
    );
  };
  const lines = issues.map((issue) => `  - ${formatPath(issue.path)}: ${issue.message}`);
  const head = issues.length === 1 ? `${subject}:` : `${issues.length} problems with this ${subject}:`;
  return {
    status: 'error',
    code: 'SCHEMA_VALIDATION',
    message: `${head}\n${lines.join('\n')}`,
    data: {
      issues: issues.map((i) => ({
        path: (i.path ?? []).map((p) => String(p)),
        message: i.message,
      })),
    },
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
export function printOutcome(raw: CommandOutcome, output: OutputOptions): number {
  // Anything a runner left as a parameter reference is spelled the way this surface
  // spells one. Idempotent, so an outcome already spelled by the Commander adapter —
  // which knows which parameters are positional and can do better than this — passes
  // through untouched.
  const outcome = spellOutcome(raw, CLI_SPELLING);
  if (output.format === 'json') {
    const stream = outcome.status === 'ok' ? process.stdout : process.stderr;
    stream.write(renderMachineJson(outcome) + '\n');
    return outcome.status === 'ok' ? 0 : (outcome.exitCode ?? 1);
  }

  if (outcome.status === 'error') {
    process.stderr.write(formatErrorText(outcome) + '\n');
    return outcome.exitCode ?? 1;
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
  if (outcome.warnings && outcome.warnings.length > 0) {
    lines.push('');
    lines.push('Warnings:');
    for (const warning of outcome.warnings) {
      lines.push(`  - ${formatWarningLine(warning)}`);
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

function formatWarningLine(warning: OutcomeWarning): string {
  const locus = warning.path ? ` (${warning.path})` : '';
  return `${warning.code}${locus}: ${warning.message}`;
}

function formatDetailValue(value: string | number | boolean | string[]): string {
  if (Array.isArray(value)) {
    return value.length === 0 ? '(none)' : value.join(', ');
  }
  return String(value);
}

function formatErrorText(outcome: ErrorOutcome): string {
  const fix = outcome.remedy
    ? `\nFix: pathfinder-cli ${[outcome.remedy.command, ...(outcome.remedy.args ?? [])].join(' ')}`
    : '';
  return `Error: ${outcome.message}${fix}`;
}

// ---------------------------------------------------------------------------
// Help-as-JSON contract
// ---------------------------------------------------------------------------

/**
 * The stable JSON shape of a command's parameter interface, emitted by
 * `--help --format json` and published to agents by `pathfinder_help`.
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
  valueType: 'string' | 'number' | 'boolean' | 'enum' | 'array' | 'union';
  enum?: readonly string[];
  /**
   * The types a `valueType: 'union'` parameter accepts, e.g. `['string', 'boolean']`.
   * Parallel to `enum`: additive key, present only on that `valueType`.
   */
  unionOf?: readonly string[];
  repeatable?: boolean;
  description: string;
  default?: unknown;
  /**
   * Whether the caller must supply this parameter. Additive key, populated by
   * the schema-driven renderer.
   *
   * The `required` / `optional` buckets cannot carry this on their own, because
   * `addressing` is a third bucket that overlaps both: `add-step`'s `parent` is
   * mandatory and `add-block`'s is not, and both land in `addressing`. Stating
   * it per-parameter removes the need for a consumer to know that rule.
   */
  required?: boolean;
}

export interface HelpJson {
  command: string;
  summary: string;
  required: HelpJsonFlag[];
  optional: HelpJsonFlag[];
  addressing?: HelpJsonFlag[];
  /** Subcommand names exposed by this command, if any. */
  subcommands?: string[];
  /**
   * Map of subcommand name → list of logically-required flag names. Surfaced
   * by `add-block` so a single help round-trip is enough to author any block
   * type. Additive key in the help-shape stability contract.
   */
  requiredByType?: Record<string, string[]>;
}
