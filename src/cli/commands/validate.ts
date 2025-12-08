/**
 * Validate Command
 *
 * Validates JSON guide files against the Zod schema.
 */

import { Command } from 'commander';

import { validateGuideFromString, toLegacyResult } from '../../validation';
import { loadGuideFiles, loadBundledGuides, type LoadedGuide } from '../utils/file-loader';

interface ValidateOptions {
  bundled?: boolean;
  strict?: boolean;
  format?: 'text' | 'json';
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

export const validateCommand = new Command('validate')
  .description('Validate JSON guide files')
  .argument('[files...]', 'JSON guide files to validate (explicit paths only)')
  .option('--bundled', 'Validate all bundled guides in src/bundled-interactives/')
  .option('--strict', 'Treat warnings as errors')
  .option('--format <format>', 'Output format: text or json', 'text')
  .action(async (files: string[], options: ValidateOptions) => {
    try {
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
        console.error('Please specify files to validate or use --bundled flag');
        process.exit(1);
      }

      const summary = validateGuides(guides, options);

      if (options.format === 'json') {
        formatJsonOutput(summary);
      } else {
        formatTextOutput(summary, options);
      }

      // Exit with error code if there are invalid files
      if (summary.invalidFiles > 0) {
        process.exit(1);
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });
