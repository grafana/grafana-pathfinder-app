/**
 * Validate Command
 *
 * Validates JSON guide files and package directories against Zod schemas.
 */

import { Command } from 'commander';
import * as path from 'path';

import {
  validateGuideFromString,
  toLegacyResult,
  validatePackage,
  validatePackageTree,
  type PackageValidationResult,
} from '../../validation';
import { loadGuideFiles, loadBundledGuides, type LoadedGuide } from '../utils/file-loader';

interface ValidateOptions {
  bundled?: boolean;
  strict?: boolean;
  format?: 'text' | 'json';
  package?: string;
  packages?: string;
}

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

function formatPackageResult(dirName: string, result: PackageValidationResult, strict: boolean): void {
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

  for (const msg of result.messages) {
    const icon = msg.severity === 'error' ? '❌' : msg.severity === 'warn' ? '⚠️ ' : 'ℹ️ ';
    console.log(`  ${icon} ${msg.severity.toUpperCase()}: ${msg.message}`);
  }
}

function runPackageValidation(packageDir: string, options: ValidateOptions): void {
  const absoluteDir = path.isAbsolute(packageDir) ? packageDir : path.resolve(process.cwd(), packageDir);
  const result = validatePackage(absoluteDir, { strict: options.strict });

  if (options.format === 'json') {
    console.log(JSON.stringify(result, null, 2));
  } else {
    formatPackageResult(path.basename(absoluteDir), result, !!options.strict);
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

export const validateCommand = new Command('validate')
  .description('Validate JSON guide files or package directories')
  .arguments('[files...]')
  .option('--bundled', 'Validate all bundled guides in src/bundled-interactives/')
  .option('--strict', 'Treat warnings as errors')
  .option('--format <format>', 'Output format: text or json', 'text')
  .option('--package <dir>', 'Validate a single package directory (expects content.json)')
  .option('--packages <dir>', 'Validate a tree of package directories')
  .action(async (files: string[], options: ValidateOptions) => {
    try {
      if (options.package) {
        return runPackageValidation(options.package, options);
      }

      if (options.packages) {
        return runPackagesValidation(options.packages, options);
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
