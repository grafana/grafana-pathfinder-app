/**
 * Validate Command
 *
 * Validates JSON guide files and package directories against Zod schemas.
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';

import type { ContentJson, ManifestJson } from '../../types/package.types';
import { validateGuideFromString, toLegacyResult } from '../../validation';
import { validatePackage, validatePackageTree, type PackageValidationResult } from '../../validation/validate-package';
import { loadGuideFiles, loadBundledGuides, type LoadedGuide } from '../utils/file-loader';
import { validatePackageState } from '../utils/package-io';
import { manyIssuesOutcome, type CommandOutcome } from '../utils/output';

interface ValidateOptions {
  bundled?: boolean;
  stdin?: boolean;
  strict?: boolean;
  format?: 'text' | 'json';
  package?: string;
  packages?: string;
  verbose?: boolean;
}

/**
 * Stable regexes for default-array INFO messages emitted by
 * `validatePackage`. Used to collapse the six "depends/recommends/.../replaces
 * defaulting to []" lines that fire on every fresh package into a single
 * summary line, freeing screen budget for real WARN/ERROR signals.
 */
const DEFAULT_ARRAY_INFO_REGEX = /^manifest\.json: "([a-zA-Z]+)" not specified, defaulting to \[\]/;

interface ValidationSummary {
  totalFiles: number;
  validFiles: number;
  invalidFiles: number;
  filesWithWarnings: number;
  errors: Array<{ file: string; errors: string[] }>;
  warnings: Array<{ file: string; warnings: string[] }>;
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
    const result = validateGuideFromString(guide.content, { strict: options.strict });
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
  // scannable without losing information for authors who want it.
  const defaultArrayFields: string[] = [];
  for (const msg of result.messages) {
    if (msg.severity === 'info' && !verbose) {
      const m = DEFAULT_ARRAY_INFO_REGEX.exec(msg.message);
      if (m) {
        defaultArrayFields.push(m[1]!);
        continue;
      }
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

function runPackageValidation(packageDir: string, options: ValidateOptions): void {
  const absoluteDir = path.isAbsolute(packageDir) ? packageDir : path.resolve(process.cwd(), packageDir);
  const result = validatePackage(absoluteDir, { strict: options.strict });

  if (options.format === 'json') {
    console.log(JSON.stringify(result, null, 2));
  } else {
    formatPackageResult(path.basename(absoluteDir), result, !!options.strict, !!options.verbose);
  }

  if (!result.isValid) {
    process.exit(1);
  }
}

function runPackagesValidation(rootDir: string, options: ValidateOptions): void {
  const absoluteRoot = path.isAbsolute(rootDir) ? rootDir : path.resolve(process.cwd(), rootDir);
  const results = validatePackageTree(absoluteRoot, { strict: options.strict });

  if (results.size === 0) {
    console.error(`No package directories found under ${absoluteRoot}`);
    process.exit(1);
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

  const hasInvalid = [...results.values()].some((r) => !r.isValid);
  if (hasInvalid) {
    process.exit(1);
  }
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

function runStdinValidation(input: string, options: ValidateOptions): void {
  const result = validateGuideFromString(input, { strict: options.strict });
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

  if (!result.isValid) {
    process.exit(1);
  }
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

export const validateCommand = new Command('validate')
  .description('Validate JSON guide files or package directories')
  .arguments('[files...]')
  .option('--bundled', 'Validate all bundled guides in src/bundled-interactives/')
  .option('--stdin', 'Read a single JSON guide from stdin instead of files')
  .option('--strict', 'Treat warnings as errors')
  .option('--format <format>', 'Output format: text or json', 'text')
  .option('--package <dir>', 'Validate a single package directory (expects content.json)')
  .option('--packages <dir>', 'Validate a tree of package directories')
  .option('--verbose', 'Show every INFO message individually (default: collapse default-array INFOs)')
  .action(async function (this: Command, files: string[]) {
    const options = this.optsWithGlobals<ValidateOptions>();
    try {
      if (options.stdin) {
        if (files.length > 0 || options.bundled || options.package || options.packages) {
          console.error('--stdin is mutually exclusive with file arguments, --bundled, --package, and --packages');
          process.exit(1);
        }
        const input = await readStdin();
        return runStdinValidation(input, options);
      }

      if (options.package) {
        return runPackageValidation(options.package, options);
      }

      if (options.packages) {
        return runPackagesValidation(options.packages, options);
      }

      // Auto-detect when a positional path is a directory: the top-level
      // command description promises "JSON guide files or package
      // directories", so a bare positional dir should Just Work without
      // forcing the user to discover --package via help text.
      const autoDetected = autoDetectPositionals(files);
      if (autoDetected) {
        if (autoDetected.kind === 'package') {
          return runPackageValidation(autoDetected.path, options);
        }
        if (autoDetected.kind === 'packages') {
          return runPackagesValidation(autoDetected.path, options);
        }
      }

      let guides: LoadedGuide[] = [];

      if (options.bundled) {
        guides = loadBundledGuides();
        if (guides.length === 0) {
          console.error('No bundled guides found in src/bundled-interactives/');
          process.exit(1);
        }
      } else if (files.length > 0) {
        guides = loadGuideFiles(files);
        if (guides.length === 0) {
          console.error('No valid JSON guide files found in the specified paths');
          process.exit(1);
        }
      } else {
        console.error('Please specify files to validate, use --bundled, --package, or --packages flag');
        process.exit(1);
      }

      const summary = validateGuides(guides, options);

      if (options.format === 'json') {
        formatJsonOutput(summary);
      } else {
        formatTextOutput(summary, options);
      }

      if (summary.invalidFiles > 0) {
        process.exit(1);
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });
