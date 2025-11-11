#!/usr/bin/env node

/**
 * Wrapper script for the TypeScript CLI
 * This allows npm/npx to execute the CLI properly
 */

const path = require('path');
const { register } = require('ts-node');

// Register ts-node with proper configuration
register({
  project: path.join(__dirname, '..', 'tsconfig.json'),
  transpileOnly: true,
});

// Load the TypeScript CLI module
const cliModule = require('./cli.ts');

// Call main() directly since require.main check won't work when loaded via wrapper
if (cliModule.main) {
  cliModule.main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
} else {
  console.error('Error: Could not find main() function in CLI module');
  process.exit(1);
}

