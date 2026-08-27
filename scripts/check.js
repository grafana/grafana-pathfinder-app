#!/usr/bin/env node
/**
 * Runs the pre-merge gate (`npm run check`).
 *
 * STEPS below is the only declaration of what the gate contains. Nothing else
 * in the repository enumerates it — the docs point here, and `--list` prints
 * the composition without running anything:
 *
 *   npm run check            # run the gate
 *   npm run check -- --list  # print the ordered steps, run nothing
 *
 * Fail-fast is deliberate. The gate stops at the first failing step and exits
 * with that step's status, the same as the `&&` chain it replaced. A contributor
 * who wants the remaining diagnostics runs the individual scripts; a gate that
 * kept going would spend minutes on Go and Jest to report a problem the first
 * step already found.
 *
 * Each entry names an npm script, and the command shown by `--list` is read
 * from `package.json` at run time rather than restated here.
 */

const path = require('path');
const { spawnSync } = require('child_process');

const STEPS = [
  'typecheck',
  'lint',
  'prettier-test',
  'docs:sync-terms:check',
  'lint:go',
  'test:go',
  'test:coverage',
  'test:review-contract',
  'test:scripts',
];

const root = path.resolve(__dirname, '..');
const scripts = require(path.join(root, 'package.json')).scripts;

function usage() {
  console.log('Usage: npm run check [-- --list]');
  console.log();
  console.log('  --list, -l   print the ordered steps and exit without running them');
  console.log('  --help, -h   print this message');
}

function list() {
  const width = Math.max(...STEPS.map((step) => step.length));
  console.log('npm run check — the local pre-merge gate. Steps run in this order, stopping at the first failure:');
  console.log();
  STEPS.forEach((step, index) => {
    console.log(`  ${String(index + 1).padStart(2)}. ${step.padEnd(width)}  ${scripts[step]}`);
  });
  console.log();
  console.log('Every step is also a standalone script — run one on its own with `npm run <step>`.');
}

function failure(result) {
  if (result.error) {
    return { code: 1, reason: `npm never ran (${result.error.message})` };
  }
  if (result.signal) {
    return { code: 1, reason: `killed by ${result.signal}` };
  }
  if (result.status !== 0) {
    return { code: result.status, reason: `exit status ${result.status}` };
  }
  return null;
}

function run() {
  for (const [index, step] of STEPS.entries()) {
    console.log(`\ncheck [${index + 1}/${STEPS.length}] npm run ${step}`);
    const result = spawnSync('npm', ['run', step], { stdio: 'inherit', cwd: root });
    const failed = failure(result);
    if (failed) {
      console.error(
        `\ncheck: failed at step ${index + 1}/${STEPS.length} (npm run ${step}): ${failed.reason}; stopping here`
      );
      return failed.code;
    }
  }

  console.log(`\ncheck: all ${STEPS.length} steps passed`);
  return 0;
}

const args = process.argv.slice(2);
const unknown = args.filter((arg) => !['--list', '-l', '--help', '-h'].includes(arg));
const missing = STEPS.filter((step) => !scripts[step]);

if (unknown.length > 0) {
  console.error(`check: unrecognised argument: ${unknown.join(' ')}`);
  usage();
  process.exit(2);
} else if (args.includes('--help') || args.includes('-h')) {
  usage();
} else if (missing.length > 0) {
  console.error(`check: no such npm script: ${missing.join(', ')}`);
  process.exit(1);
} else if (args.includes('--list') || args.includes('-l')) {
  list();
} else {
  process.exit(run());
}
