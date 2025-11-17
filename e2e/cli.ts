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

/**
 * Check if a guide URL is a local file path (not supported)
 * 
 * Local file paths won't work because Pathfinder needs URLs accessible from the browser.
 * Only URLs compatible with Pathfinder dev tools are allowed:
 * - bundled: URLs
 * - GitHub raw URLs (https://raw.githubusercontent.com/...)
 * - Data proxy URLs (api/plugin-proxy/...)
 * 
 * @param url - The guide URL to validate
 * @returns true if the URL is a local file path
 */
function isLocalFilePath(url: string): boolean {
  // Allow valid URL formats
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return false; // HTTP/HTTPS URLs are valid
  }
  
  if (url.startsWith('bundled:')) {
    return false; // Bundled guides are valid
  }
  
  if (url.startsWith('api/')) {
    return false; // Data proxy URLs are valid
  }
  
  // Reject local file path patterns
  // Absolute paths
  if (url.startsWith('/')) {
    return true;
  }
  
  // Relative paths
  if (url.startsWith('./') || url.startsWith('../')) {
    return true;
  }
  
  // file:// protocol
  if (url.startsWith('file://')) {
    return true;
  }
  
  // Windows paths (C:\ or similar)
  if (/^[A-Za-z]:[\\/]/.test(url)) {
    return true;
  }
  
  // Plain filenames without protocol (e.g., "guide.html")
  // These are likely local files, not URLs
  if (/\.(html|htm)$/i.test(url) && !url.includes('://') && !url.startsWith('bundled:') && !url.startsWith('api/')) {
    return true;
  }
  
  return false;
}

function parseArgs(): TestConfig {
  const args = process.argv.slice(2);
  let guideUrl: string | null = null;
  let grafanaUrl = DEFAULT_GRAFANA_URL;
  let outputDir = DEFAULT_OUTPUT_DIR;
  let startStack = false;
  let stackMode: 'local' | 'remote' = 'local';
  let grafanaSession: string | undefined;
  let grafanaSessionExpiry: string | undefined;

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
    } else if (arg === '--stack-profile' && nextArg) {
      if (nextArg === 'local' || nextArg === 'remote') {
        stackMode = nextArg;
      } else {
        console.error(`Error: --stack-profile must be 'local' or 'remote', got '${nextArg}'`);
        printHelp();
        process.exit(1);
      }
      i++;
    } else if (arg === '--grafana-session' && nextArg) {
      grafanaSession = nextArg;
      i++;
    } else if (arg === '--grafana-session-expiry' && nextArg) {
      grafanaSessionExpiry = nextArg;
      i++;
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

  // Validate guide URL - must be a URL compatible with Pathfinder dev tools
  // Reject local file paths as they won't work (Pathfinder needs accessible URLs)
  if (isLocalFilePath(guideUrl)) {
    console.error('Error: Local file paths are not supported. Guide URLs must be accessible to Pathfinder.');
    console.error('');
    console.error('Use one of these formats instead:');
    console.error('  - Bundled guide: bundled:welcome-to-grafana');
    console.error('  - GitHub raw URL: https://raw.githubusercontent.com/grafana/interactive-tutorials/main/path/unstyled.html');
    console.error('  - Data proxy URL: api/plugin-proxy/grafana-pathfinder-app/github-raw/path/unstyled.html');
    console.error('');
    printHelp();
    process.exit(1);
  }

  // Auto-detect remote stack mode if cookies are provided
  if (grafanaSession || grafanaSessionExpiry) {
    stackMode = 'remote';
    if (!grafanaSession || !grafanaSessionExpiry) {
      console.error('Error: Both --grafana-session and --grafana-session-expiry are required for remote stacks');
      printHelp();
      process.exit(1);
    }
  }

  // Resolve output directory to absolute path
  outputDir = resolve(outputDir);

  return {
    guideUrl,
    grafanaUrl,
    outputDir,
    startStack,
    timeout: DEFAULT_TIMEOUT,
    stackMode,
    grafanaSession,
    grafanaSessionExpiry,
  };
}

function printHelp(): void {
  console.log(`
Usage: test-guide --guide <url> [options]

Options:
  --guide <url>                    Guide URL to test (must be accessible to Pathfinder, not a local file path)
  --grafana-url <url>              Grafana instance URL (default: http://localhost:3000)
  --output <dir>                   Output directory for test results (default: ./test-results)
  --start-stack                    Automatically start Grafana stack (runs npm run server)
  --stack-profile <local|remote>   Stack profile mode (default: local, auto-detected if cookies provided)
  --grafana-session <cookie>       Grafana session cookie for remote stack authentication
  --grafana-session-expiry <date>  Grafana session expiry date (ISO format) for remote stack authentication
  --help, -h                       Show this help message

Guide URL Formats:
  Guide URLs must be accessible to Pathfinder from the browser. Supported formats:
  
  - Bundled guide:
    bundled:welcome-to-grafana
  
  - GitHub raw URL:
    https://raw.githubusercontent.com/grafana/interactive-tutorials/main/path/unstyled.html
  
  - Data proxy URL:
    api/plugin-proxy/grafana-pathfinder-app/github-raw/path/unstyled.html

  Note: Local file paths (e.g., ./guide.html, /path/to/guide.html) are NOT supported
        because Pathfinder needs URLs accessible from the browser context.

Examples:
  # Local stack with bundled guide
  npx grafana-pathfinder-app test-guide --guide bundled:welcome-to-grafana

  # Local stack with GitHub URL
  npx grafana-pathfinder-app test-guide --guide \\
    "https://raw.githubusercontent.com/grafana/interactive-tutorials/main/welcome-to-grafana/unstyled.html"

  # Remote stack (Grafana Cloud, Play, etc.)
  npx grafana-pathfinder-app test-guide --guide bundled:welcome-to-grafana \\
    --grafana-url https://your-instance.grafana.net \\
    --grafana-session "your-session-cookie-value" \\
    --grafana-session-expiry "2024-12-31T23:59:59Z"

  # Explicit stack profile with GitHub URL
  npx grafana-pathfinder-app test-guide \\
    --guide "https://raw.githubusercontent.com/grafana/interactive-tutorials/main/explore-drilldowns-101/unstyled.html" \\
    --stack-profile remote \\
    --grafana-url https://play.grafana.org \\
    --grafana-session "session-value" \\
    --grafana-session-expiry "2024-12-31T23:59:59Z"
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

