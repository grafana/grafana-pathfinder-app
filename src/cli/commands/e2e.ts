/**
 * E2E Test Command
 *
 * Run E2E tests on JSON guide files. This is a skeleton that validates guides
 * and will integrate with Playwright in a later milestone (L3-2B).
 */

import { Command } from 'commander';

import { validateGuideFromString, toLegacyResult } from '../../validation';
import { loadGuideFiles, loadBundledGuides, type LoadedGuide } from '../utils/file-loader';

/**
 * CLI options for the e2e command
 */
interface E2ECommandOptions {
  grafanaUrl: string;
  output?: string;
  artifacts: string;
  verbose: boolean;
  bundled: boolean;
  trace: boolean;
}

/**
 * Exit codes per design spec
 */
export const ExitCode = {
  SUCCESS: 0,
  TEST_FAILURE: 1,
  CONFIGURATION_ERROR: 2,
  GRAFANA_UNREACHABLE: 3,
  AUTH_FAILURE: 4,
} as const;

/**
 * Validate all loaded guides and return any validation errors.
 */
function validateAllGuides(
  guides: LoadedGuide[],
  options: E2ECommandOptions
): { valid: LoadedGuide[]; errors: Array<{ file: string; errors: string[] }> } {
  const valid: LoadedGuide[] = [];
  const errors: Array<{ file: string; errors: string[] }> = [];

  for (const guide of guides) {
    const result = validateGuideFromString(guide.content);
    const legacy = toLegacyResult(result);

    if (result.isValid) {
      valid.push(guide);
      if (options.verbose && result.warnings.length > 0) {
        console.log(`⚠️  ${guide.path}: ${result.warnings.length} warning(s)`);
      }
    } else {
      errors.push({ file: guide.path, errors: legacy.errors });
    }
  }

  return { valid, errors };
}

/**
 * Load a specific bundled guide by name (e.g., "bundled:welcome-to-grafana")
 * Matches against the filename without extension.
 */
function loadBundledGuide(name: string): LoadedGuide | null {
  const guideName = name.replace(/^bundled:/, '');
  const allBundled = loadBundledGuides();

  // First try exact match (filename without .json)
  const exactMatch = allBundled.find((g) => {
    const filename = g.path.split('/').pop()?.replace('.json', '') ?? '';
    return filename === guideName;
  });

  if (exactMatch) {
    return exactMatch;
  }

  // Fall back to partial match for convenience
  return allBundled.find((g) => g.path.includes(guideName)) ?? null;
}

/**
 * Resolve guide inputs to LoadedGuide array.
 * Supports: file paths, --bundled flag, and bundled:name syntax.
 */
function resolveGuides(files: string[], options: E2ECommandOptions): LoadedGuide[] {
  const guides: LoadedGuide[] = [];

  if (options.bundled) {
    // Load all bundled guides
    return loadBundledGuides();
  }

  for (const file of files) {
    if (file.startsWith('bundled:')) {
      // Handle bundled:name syntax
      const guide = loadBundledGuide(file);
      if (guide) {
        guides.push(guide);
      } else {
        console.warn(`Bundled guide not found: ${file}`);
      }
    } else {
      // Regular file path
      const loaded = loadGuideFiles([file]);
      guides.push(...loaded);
    }
  }

  return guides;
}

export const e2eCommand = new Command('e2e')
  .description('Run E2E tests on JSON guide files')
  .arguments('[files...]')
  .option('--grafana-url <url>', 'Grafana instance URL', 'http://localhost:3000')
  .option('--output <path>', 'Path for JSON report output')
  .option('--artifacts <dir>', 'Directory for failure artifacts', './artifacts')
  .option('--verbose', 'Enable verbose logging', false)
  .option('--bundled', 'Test all bundled guides')
  .option('--trace', 'Generate Playwright trace file', false)
  .action(async (files: string[], options: E2ECommandOptions) => {
    try {
      // Resolve guides from inputs
      const guides = resolveGuides(files, options);

      if (guides.length === 0) {
        if (options.bundled) {
          console.error('❌ No bundled guides found in src/bundled-interactives/');
        } else if (files.length === 0) {
          console.error('❌ Please specify guide files or use --bundled flag');
          console.error('   Usage: pathfinder-cli e2e ./guide.json');
          console.error('          pathfinder-cli e2e --bundled');
          console.error('          pathfinder-cli e2e bundled:welcome-to-grafana');
        } else {
          console.error('❌ No valid guide files found in the specified paths');
        }
        process.exit(ExitCode.CONFIGURATION_ERROR);
      }

      if (options.verbose) {
        console.log(`\n📂 Loaded ${guides.length} guide(s):`);
        for (const guide of guides) {
          console.log(`   - ${guide.path}`);
        }
        console.log();
      }

      // Validate all guides
      const { valid, errors } = validateAllGuides(guides, options);

      // Report validation errors
      if (errors.length > 0) {
        console.error('\n❌ Guide validation failed:\n');
        for (const { file, errors: fileErrors } of errors) {
          console.error(`  ${file}:`);
          for (const error of fileErrors) {
            console.error(`    - ${error}`);
          }
          console.error();
        }
        process.exit(ExitCode.CONFIGURATION_ERROR);
      }

      // All guides valid - print success and placeholder message
      console.log(`\n✅ Guide validation passed for ${valid.length} guide(s).`);
      console.log('\n📋 E2E test configuration:');
      console.log(`   Grafana URL: ${options.grafanaUrl}`);
      console.log(`   Artifacts:   ${options.artifacts}`);
      if (options.output) {
        console.log(`   Output:      ${options.output}`);
      }
      if (options.trace) {
        console.log(`   Trace:       enabled`);
      }
      console.log('\n🚧 Playwright tests will run here. (Coming in L3-2B)\n');
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(ExitCode.CONFIGURATION_ERROR);
    }
  });
