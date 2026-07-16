#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = process.env.E2E_RUNNER_ROOT || path.resolve(__dirname, '..');
const schema = JSON.parse(fs.readFileSync(path.join(root, 'src/cli/e2e/schemas/e2e-test-report.schema.json'), 'utf8'));
const pass = JSON.parse(fs.readFileSync(path.join(root, 'src/cli/e2e/schemas/fixtures/e2e-report-pass.json'), 'utf8'));
const fail = JSON.parse(fs.readFileSync(path.join(root, 'src/cli/e2e/schemas/fixtures/e2e-report-fail.json'), 'utf8'));

if (schema.$id !== 'https://grafana.com/schemas/pathfinder/e2e-test-report-1.0.0.json') {
  throw new Error('unexpected E2E report schema id');
}
for (const report of [pass, fail]) {
  for (const field of [
    'schemaVersion',
    'outcome',
    'runner',
    'startedAt',
    'endedAt',
    'target',
    'guide',
    'config',
    'summary',
    'steps',
  ]) {
    if (!(field in report)) {
      throw new Error(`fixture is missing ${field}`);
    }
  }
}
if (pass.outcome !== 'passed' || fail.outcome !== 'failed' || fail.errorCode !== 'MANDATORY_FAILURE') {
  throw new Error('deterministic report fixtures have unexpected outcomes');
}
for (const fixture of ['always-passes', 'always-fails']) {
  const contentPath = path.join(root, 'tests/e2e-runner/fixtures', fixture, 'content.json');
  if (!fs.existsSync(contentPath)) {
    throw new Error(`missing deterministic guide fixture: ${fixture}`);
  }
}

console.log('E2E runner contract smoke passed');
