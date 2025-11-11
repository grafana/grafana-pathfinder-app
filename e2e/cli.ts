#!/usr/bin/env node

/**
 * CLI interface for running guide tests
 * 
 * This script can be executed directly or via npx:
 *   npx grafana-pathfinder-app test-guide --guide <url>
 */

// Register ts-node if TypeScript files need to be executed
if (require.extensions['.ts']) {
  // Already registered
} else {
  try {
    require('ts-node/register');
  } catch (e) {
    // ts-node not available, assume pre-compiled
  }
}

import { runGuideTest } from './guide-runner';
import { TestConfig } from './types';
import { resolve } from 'path';

const DEFAULT_GRAFANA_URL = 'http://localhost:3000';
const DEFAULT_OUTPUT_DIR = './test-results';
const DEFAULT_TIMEOUT = 30000;

function parseArgs(): TestConfig {
  const args = process.argv.slice(2);
  let guideUrl: string | null = null;
  let grafanaUrl = DEFAULT_GRAFANA_URL;
  let outputDir = DEFAULT_OUTPUT_DIR;
  let startStack = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    if (arg === '--guide' && nextArg) {
      guideUrl = nextArg;
      i++;
    } else if (arg === '--grafana-url' && nextArg) {
      grafanaUrl = nextArg;
      i++;
    } else if (arg === '--output' && nextArg) {
      outputDir = nextArg;
      i++;
    } else if (arg === '--start-stack') {
      startStack = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  if (!guideUrl) {
    console.error('Error: --guide option is required');
    printHelp();
    process.exit(1);
  }

  // Resolve output directory to absolute path
  outputDir = resolve(outputDir);

  return {
    guideUrl,
    grafanaUrl,
    outputDir,
    startStack,
    timeout: DEFAULT_TIMEOUT,
  };
}

function printHelp(): void {
  console.log(`
Usage: test-guide --guide <url> [options]

Options:
  --guide <url>          Guide URL to test (e.g., "bundled:welcome-to-grafana" or file path)
  --grafana-url <url>    Grafana instance URL (default: http://localhost:3000)
  --output <dir>         Output directory for test results (default: ./test-results)
  --start-stack          Automatically start Grafana stack (runs npm run server)
  --help, -h             Show this help message

Examples:
  npx grafana-pathfinder-app test-guide --guide bundled:welcome-to-grafana
  npx grafana-pathfinder-app test-guide --guide ./path/to/guide.html --grafana-url http://localhost:3000
  npx grafana-pathfinder-app test-guide --guide bundled:welcome-to-grafana --output ./results
`);
}

async function main(): Promise<void> {
  const config = parseArgs();

  console.log('=== Pathfinder Guide E2E Test ===');
  console.log(`Guide: ${config.guideUrl}`);
  console.log(`Grafana URL: ${config.grafanaUrl}`);
  console.log(`Output: ${config.outputDir}`);
  console.log('');

  // Check if Grafana is accessible
  try {
    const response = await fetch(config.grafanaUrl);
    if (!response.ok) {
      console.error(`Error: Grafana at ${config.grafanaUrl} returned status ${response.status}`);
      console.error('Make sure Grafana is running (npm run server)');
      process.exit(1);
    }
  } catch (error) {
    console.error(`Error: Cannot connect to Grafana at ${config.grafanaUrl}`);
    console.error('Make sure Grafana is running (npm run server)');
    process.exit(1);
  }

  // Handle stack startup if requested
  if (config.startStack) {
    console.log('Note: --start-stack is not yet implemented');
    console.log('Please run "npm run server" in a separate terminal');
  }

  // Run the test
  try {
    const report = await runGuideTest(config);
    const exitCode = report.summary.failed > 0 ? 1 : 0;
    process.exit(exitCode);
  } catch (error) {
    console.error('Test execution failed:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { main };

