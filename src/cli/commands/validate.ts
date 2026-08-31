/**
 * Validate Command
 *
 * Validates JSON guide files and package directories against Zod schemas.
 */

import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';

import { SnippetCatalogSchema } from '../../types/json-snippet.schema';
import type { ContentJson, ManifestJson } from '../../types/package.types';
import { validateGuideFromString, toLegacyResult } from '../../validation';
import { readJsonFile } from '../../validation/package-io';
import { validatePackage, validatePackageTree, type PackageValidationResult } from '../../validation/validate-package';
import { defineCommand } from '../contracts';
import { loadGuideFiles, loadBundledGuides, resolveCliPath, type LoadedGuide } from '../utils/file-loader';
import { validatePackageState } from '../utils/package-io';
import { manyIssuesOutcome, type CommandOutcome } from '../utils/output';

type ValidateOptions = ValidateCliInput & { snippetCatalogIds?: ReadonlySet<string> };

/**
 * Stable message code (defined in `validate-package.ts`) for the six
 * "depends/recommends/.../replaces defaulting to []" INFO lines that fire on
 * every fresh package. The collapse below folds them into a single summary
 * line so real WARN/ERROR signals stay scannable.
 */
const DEFAULT_DEP_FIELD_INFO_CODE = 'manifest_dep_field_defaulted';

interface ValidationSummary {
  totalFiles: number;
  validFiles: number;
  invalidFiles: number;
  filesWithWarnings: number;
  errors: Array<{ file: string; errors: string[] }>;
  warnings: Array<{ file: string; warnings: string[] }>;
}

function loadSnippetCatalogIds(catalogPath: string): ReadonlySet<string> {
  const absolutePath = resolveCliPath(catalogPath);
  const read = readJsonFile(absolutePath, SnippetCatalogSchema);

  if (!read.ok) {
    const detail =
      read.code === 'schema_validation'
        ? read.issues?.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
        : read.message;

    throw new Error(`Cannot use snippets catalog "${absolutePath}": ${detail ?? 'unknown error'}`);
  }

  return new Set(Object.keys(read.data));
}

function validateGuides(guides: LoadedGuide[], options: ValidateOptions): ValidationSummary {
  const summary: ValidationSummary = {
    totalFiles: guides.length,
    validFiles: 0,
    invalidFiles: 0,
    filesWithWarnings: 0,
    errors: [],
    warnings: [],
  };

  for (const guide of guides) {
    const result = validateGuideFromString(guide.content, {
      strict: options.strict,
      snippetCatalogIds: options.snippetCatalogIds,
    });

    const legacy = toLegacyResult(result);

    if (result.isValid) {
      summary.validFiles++;
      if (result.warnings.length > 0) {
        summary.filesWithWarnings++;
        summary.warnings.push({ file: guide.path, warnings: legacy.warnings });
      }
    } else {
      summary.invalidFiles++;
      summary.errors.push({ file: guide.path, errors: legacy.errors });
    }
  }

  return summary;
}

function formatTextOutput(summary: ValidationSummary, options: ValidateOptions): void {
  console.log('\n📋 Validation Results');
  console.log('═'.repeat(50));
  console.log(`Total files:    ${summary.totalFiles}`);
  console.log(`Valid:          ${summary.validFiles}`);
  console.log(`Invalid:        ${summary.invalidFiles}`);
  if (!options.strict) {
    console.log(`With warnings:  ${summary.filesWithWarnings}`);
  }
  console.log('═'.repeat(50));

  if (summary.errors.length > 0) {
    console.log('\n❌ Errors:\n');
    for (const { file, errors } of summary.errors) {
      console.log(`  ${file}:`);
      for (const error of errors) {
        console.log(`    - ${error}`);
      }
      console.log();
    }
  }

  if (!options.strict && summary.warnings.length > 0) {
    console.log('\n⚠️  Warnings:\n');
    for (const { file, warnings } of summary.warnings) {
      console.log(`  ${file}:`);
      for (const warning of warnings) {
        console.log(`    - ${warning}`);
      }
      console.log();
    }
  }

  if (summary.invalidFiles === 0) {
    console.log('\n✅ All guides valid!\n');
  } else {
    console.log(`\n❌ ${summary.invalidFiles} guide(s) failed validation.\n`);
  }
}

function formatJsonOutput(summary: ValidationSummary): void {
  console.log(JSON.stringify(summary, null, 2));
}

// --- Package validation output ---

function formatPackageResult(dirName: string, result: PackageValidationResult, strict: boolean, verbose = false): void {
  const status = result.isValid ? '✅' : '❌';
  console.log(`\n${status} ${dirName} (${result.packageId ?? 'unknown id'})`);

  for (const err of result.errors) {
    console.log(`  ❌ ERROR: ${err.message}`);
  }

  if (!strict) {
    for (const warn of result.warnings) {
      console.log(`  ⚠️  WARN: ${warn.message}`);
    }
  }

  // Collapse the default-array INFO messages into a single summary line
  // unless --verbose. Six identical-shape "defaulting to []" lines on every
  // fresh package drown out real warnings; one summary keeps validate output
  // scannable without losing information for authors who want it. The
  // producer tags each line with a stable `code` so we match on that rather
  // than the message text.
  const defaultArrayFields: string[] = [];
  for (const msg of result.messages) {
    if (msg.code === DEFAULT_DEP_FIELD_INFO_CODE && !verbose) {
      // The field name is the last path segment (e.g. ['manifest.json',
      // 'depends'] → 'depends'). Producer always sets the 2-segment path;
      // fall back to '?' if a future variant doesn't, to avoid a crash.
      defaultArrayFields.push(msg.path?.[msg.path.length - 1] ?? '?');
      continue;
    }
    const icon = msg.severity === 'error' ? '❌' : msg.severity === 'warn' ? '⚠️ ' : 'ℹ️ ';
    console.log(`  ${icon} ${msg.severity.toUpperCase()}: ${msg.message}`);
    if (msg.remediation) {
      console.log(`      Fix: ${msg.remediation}`);
    }
  }
  if (defaultArrayFields.length > 0) {
    console.log(
      `  ℹ️  INFO: ${defaultArrayFields.length} optional manifest field(s) not set (${defaultArrayFields.join(', ')}) — run with --verbose for details.`
    );
  }

  // Explicit PASS / FAIL trailer so success is unambiguous when WARNs are
  // present in the body. Tested by every audit scenario; previously authors
  // had to scan for `❌ ERROR` lines or rely on exit code.
  if (result.isValid) {
    console.log('\n✅ PASS');
  } else {
    console.log('\n❌ FAIL');
  }
}

function runPackageValidation(packageDir: string, options: ValidateOptions): CommandOutcome {
  const absoluteDir = resolveCliPath(packageDir);
  const result = validatePackage(absoluteDir, {
    strict: options.strict,
    snippetCatalogIds: options.snippetCatalogIds,
  });

  if (options.format === 'json') {
    console.log(JSON.stringify(result, null, 2));
  } else {
    formatPackageResult(path.basename(absoluteDir), result, !!options.strict, !!options.verbose);
  }

  return result.isValid
    ? { status: 'ok', summary: `${path.basename(absoluteDir)} is valid` }
    : { status: 'error', code: 'PACKAGE_INVALID', message: `${path.basename(absoluteDir)} failed validation` };
}

function runPackagesValidation(rootDir: string, options: ValidateOptions): CommandOutcome {
  const absoluteRoot = resolveCliPath(rootDir);
  const results = validatePackageTree(absoluteRoot, {
    strict: options.strict,
    snippetCatalogIds: options.snippetCatalogIds,
  });

  if (results.size === 0) {
    const message = `No package directories found under ${absoluteRoot}`;
    console.error(message);
    return { status: 'error', code: 'NO_PACKAGES', message };
  }

  if (options.format === 'json') {
    const jsonResults: Record<string, PackageValidationResult> = {};
    for (const [name, result] of results) {
      jsonResults[name] = result;
    }
    console.log(JSON.stringify(jsonResults, null, 2));
  } else {
    let valid = 0;
    let invalid = 0;

    for (const [name, result] of results) {
      formatPackageResult(name, result, !!options.strict);
      if (result.isValid) {
        valid++;
      } else {
        invalid++;
      }
    }

    console.log('\n📋 Package Validation Summary');
    console.log('═'.repeat(50));
    console.log(`Total packages: ${results.size}`);
    console.log(`Valid:          ${valid}`);
    console.log(`Invalid:        ${invalid}`);
    console.log('═'.repeat(50));

    if (invalid === 0) {
      console.log('\n✅ All packages valid!\n');
    } else {
      console.log(`\n❌ ${invalid} package(s) failed validation.\n`);
    }
  }

  const invalidCount = [...results.values()].filter((r) => !r.isValid).length;
  return invalidCount === 0
    ? { status: 'ok', summary: `${results.size} package(s) valid` }
    : { status: 'error', code: 'PACKAGE_INVALID', message: `${invalidCount} package(s) failed validation` };
}

// --- Stdin validation ---

export function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    process.stdin.on('error', reject);
  });
}

function runFileValidation(guides: LoadedGuide[], options: ValidateOptions): CommandOutcome {
  const summary = validateGuides(guides, options);
  if (options.format === 'json') {
    formatJsonOutput(summary);
  } else {
    formatTextOutput(summary, options);
  }
  return summary.invalidFiles === 0
    ? { status: 'ok', summary: `${summary.validFiles} guide(s) valid` }
    : { status: 'error', code: 'GUIDE_INVALID', message: `${summary.invalidFiles} guide(s) failed validation` };
}

function runStdinValidation(input: string, options: ValidateOptions): CommandOutcome {
  const result = validateGuideFromString(input, {
    strict: options.strict,
    snippetCatalogIds: options.snippetCatalogIds,
  });
  const legacy = toLegacyResult(result);

  if (options.format === 'json') {
    const { isValid, errors, warnings } = legacy;
    console.log(JSON.stringify({ isValid, errors, warnings }, null, 2));
  } else {
    if (result.isValid) {
      console.log('✅ Valid guide');
      if (!options.strict && result.warnings.length > 0) {
        console.log(`\n⚠️  Warnings:\n`);
        for (const warning of legacy.warnings) {
          console.log(`  - ${warning}`);
        }
      }
    } else {
      console.log('❌ Invalid guide\n');
      for (const error of legacy.errors) {
        console.log(`  - ${error}`);
      }
    }
  }

  return result.isValid
    ? { status: 'ok', summary: 'Valid guide' }
    : { status: 'error', code: 'GUIDE_INVALID', message: 'Invalid guide' };
}

/**
 * Recognize when a single positional argument points at a package directory
 * (or a tree of them) so users don't have to remember `--package` /
 * `--packages` flags. Returns null on anything ambiguous so the file-loading
 * code path can take over.
 *
 * Heuristics:
 * - Single arg + dir contains `content.json` → 'package'
 * - Single arg + dir contains zero `content.json` directly but at least one
 *   immediate child has `content.json` → 'packages' (treats it as a tree)
 * - Anything else → null (let the existing file loader handle it).
 */
function autoDetectPositionals(files: string[]): { kind: 'package' | 'packages'; path: string } | null {
  if (files.length !== 1) {
    return null;
  }
  const target = files[0]!;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(target);
  } catch {
    return null;
  }
  if (!stat.isDirectory()) {
    return null;
  }
  if (fs.existsSync(path.join(target, 'content.json'))) {
    return { kind: 'package', path: target };
  }
  // Look one level deep for a child that's itself a package.
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(target, { withFileTypes: true });
  } catch {
    return null;
  }
  const hasChildPackage = entries.some(
    (entry) => entry.isDirectory() && fs.existsSync(path.join(target, entry.name, 'content.json'))
  );
  if (hasChildPackage) {
    return { kind: 'packages', path: target };
  }
  return null;
}

/**
 * Tagged dispatch result for the `validate` command. Each variant maps to
 * exactly one runner. `error` carries a user-facing message for invalid flag
 * combinations the action prints to stderr before exiting non-zero.
 */
type ValidateMode =
  | { kind: 'stdin' }
  | { kind: 'package'; path: string }
  | { kind: 'packages'; path: string }
  | { kind: 'bundled' }
  | { kind: 'files'; paths: string[] }
  | { kind: 'error'; message: string };

function resolveMode(options: ValidateOptions, files: string[]): ValidateMode {
  if (options.stdin) {
    if (files.length > 0 || options.bundled || options.package || options.packages) {
      return {
        kind: 'error',
        message: '--stdin is mutually exclusive with file arguments, --bundled, --package, and --packages',
      };
    }
    return { kind: 'stdin' };
  }
  if (options.package) {
    return { kind: 'package', path: options.package };
  }
  if (options.packages) {
    return { kind: 'packages', path: options.packages };
  }
  // Auto-detect: a single positional directory argument is interpreted as a
  // package (if it has content.json) or a tree (if its children do). The
  // top-level command description promises "JSON guide files or package
  // directories" so a bare positional dir should Just Work without forcing
  // the user to discover --package via help text.
  const autoDetected = autoDetectPositionals(files);
  if (autoDetected) {
    return autoDetected;
  }
  if (options.bundled) {
    return { kind: 'bundled' };
  }
  if (files.length > 0) {
    return { kind: 'files', paths: files };
  }
  return {
    kind: 'error',
    message: 'Please specify files to validate, use --bundled, --package, or --packages flag',
  };
}

export interface ValidateArgs {
  content: ContentJson;
  manifest?: ManifestJson;
  manifestSchemaVersionAuthored?: boolean;
}

/**
 * In-memory artifact validation runner used by the MCP `pathfinder_validate`
 * tool. Composes the same `validatePackageState` gate every authoring write
 * goes through, but takes the artifact directly rather than reading it from
 * disk. The Commander `validate` command stays disk-oriented for CLI users;
 * this runner exists so the MCP can validate the in-flight artifact without
 * a temp directory or file IO.
 */
export function runValidate(args: ValidateArgs): CommandOutcome {
  const outcome = validatePackageState(args.content, args.manifest, {
    manifestSchemaVersionAuthored: args.manifestSchemaVersionAuthored ?? args.manifest !== undefined,
  });

  if (!outcome.ok) {
    return manyIssuesOutcome(outcome.issues, 'package');
  }

  return {
    status: 'ok',
    summary: 'Package state is valid',
    data: {
      id: args.content.id,
      schemaVersion: args.content.schemaVersion,
      blocks: Array.isArray(args.content.blocks) ? args.content.blocks.length : 0,
    },
  };
}

export const ValidateCliCommand = z.object({
  files: z.array(z.string()).default([]).describe('Guide files or a package directory').meta({ role: 'io' }),
  bundled: z
    .boolean()
    .default(false)
    .describe('Validate all bundled guides in src/bundled-interactives/')
    .meta({ role: 'io' }),
  stdin: z.boolean().default(false).describe('Read a single JSON guide from stdin instead of files').meta({
    role: 'io',
  }),
  strict: z.boolean().default(false).describe('Treat warnings as errors').meta({ role: 'control' }),
  // Deliberately no default: `--format` is also a root-program option, and a local
  // default would shadow it. The Commander mount inherits the root's value instead.
  format: z.enum(['text', 'json']).optional().describe('Output format: text or json').meta({ role: 'io' }),
  package: z
    .string()
    .optional()
    .describe('Validate a single package directory (expects content.json)')
    .meta({ role: 'io' }),
  packages: z.string().optional().describe('Validate a tree of package directories').meta({ role: 'io' }),
  snippetsCatalog: z
    .string()
    .optional()
    .describe('Validate snippet-ref IDs against this generated snippets catalog')
    .meta({ role: 'io' }),
  verbose: z
    .boolean()
    .default(false)
    .describe('Show every INFO message individually (default: collapse default-array INFOs)')
    .meta({ role: 'control' }),
});

export type ValidateCliInput = z.output<typeof ValidateCliCommand>;

/**
 * Disk-oriented validation for CLI users. Each mode prints its own report and the
 * exit code is the result, so the outcome returned here carries the status only.
 */
export async function runValidateCli(args: ValidateCliInput): Promise<CommandOutcome> {
  const failed = (code: string, message: string): CommandOutcome => ({ status: 'error', code, message });
  try {
    const mode = resolveMode(args, args.files);

    if (mode.kind === 'error') {
      console.error(mode.message);
      return failed('INVALID_OPTIONS', mode.message);
    }

    const options = args.snippetsCatalog
      ? { ...args, snippetCatalogIds: loadSnippetCatalogIds(args.snippetsCatalog) }
      : args;

    switch (mode.kind) {
      case 'stdin':
        return runStdinValidation(await readStdin(), options);

      case 'package':
        return runPackageValidation(mode.path, options);

      case 'packages':
        return runPackagesValidation(mode.path, options);

      case 'bundled':
      case 'files': {
        const guides = mode.kind === 'bundled' ? loadBundledGuides() : loadGuideFiles(mode.paths);

        if (guides.length === 0) {
          const message =
            mode.kind === 'bundled'
              ? 'No bundled guides found in src/bundled-interactives/'
              : 'No valid JSON guide files found in the specified paths';

          console.error(message);
          return failed('NO_GUIDES', message);
        }

        return runFileValidation(guides, options);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error:', message);
    return failed('VALIDATE_FAILED', message);
  }
}

export const validateCliSpec = defineCommand({
  name: 'validate',
  summary: 'Validate JSON guide files or package directories',
  schema: ValidateCliCommand,
  // Five report renderings — per-file, per-package, tree summary, stdin, JSON — all
  // older than the outcome envelope and read by humans and CI as they are.
  emits: 'stream',
  run: runValidateCli,
});
