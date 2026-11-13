import { appendFileSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareBaseline, flattenCatalog, inspectCatalogs, pruneBaseline } from './lib/i18n-ratchet.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const baselinePath = path.join(root, 'src/locales/parity-baseline.json');
const catalogName = 'grafana-pathfinder-app.json';
const require = createRequire(import.meta.url);

function readCatalogs() {
  const configured = require('../src/locales/i18next-parser.config.js').locales;
  const directories = readdirSync(path.join(root, 'src/locales'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  return Object.fromEntries(
    [...new Set([...configured, ...directories])]
      .sort()
      .map((locale) => [
        locale,
        flattenCatalog(JSON.parse(readFileSync(path.join(root, 'src/locales', locale, catalogName), 'utf8'))),
      ])
  );
}

export function escapeAnnotation(value) {
  return value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

function report(level, message) {
  if (process.env.GITHUB_ACTIONS === 'true') {
    console.log(`::${level}::${escapeAnnotation(message)}`);
  } else {
    console.log(`${level}: ${message}`);
  }
}

function run() {
  const args = process.argv.slice(2);
  const prune = args[0] === '--prune' && args.length === 1;
  if (args.length && !prune) {
    throw new Error('Usage: node scripts/check-i18n.mjs [--prune]');
  }
  const catalogs = readCatalogs();
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const { violations, empty } = inspectCatalogs(catalogs);
  const activeBaseline = prune ? pruneBaseline(baseline, violations) : baseline;
  if (prune) {
    writeFileSync(baselinePath, `${JSON.stringify(activeBaseline, null, 2)}\n`);
    console.log('Removed resolved exceptions. No new exceptions were added.');
  }
  const { added, stale } = compareBaseline(violations, activeBaseline);
  const summary = [
    '## Translation parity',
    '',
    '| Locale | Structural violations | Empty values |',
    '| --- | ---: | ---: |',
  ];
  for (const [locale, entries] of violations) {
    summary.push(`| ${locale} | ${entries.size} | ${empty.get(locale).length} |`);
    if (entries.size || empty.get(locale).length) {
      report(
        'warning',
        `${locale}: ${entries.size} structural violations, ${empty.get(locale).length} empty translations. Only baseline exceptions are permitted.`
      );
    }
  }
  if (activeBaseline.groups.some((group) => group.tracking === 'pending')) {
    report(
      'warning',
      'Translation debt tracking is pending. Replace pending baseline references with the approved follow-up issue before merge.'
    );
    summary.push('', 'Debt tracking is pending. The operator has deferred issue creation.');
  }
  for (const entry of added) {
    report('error', `New translation violation: ${entry}. Fix the catalog instead of expanding the baseline.`);
  }
  for (const entry of stale) {
    report('error', `Resolved baseline entry: ${entry}. Run npm run i18n:baseline:prune.`);
  }
  summary.push('', `New violations: ${added.length}. Resolved baseline entries: ${stale.length}.`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary.join('\n')}\n`);
  }
  console.log(`Translation parity: ${added.length} new violations, ${stale.length} resolved baseline entries.`);
  process.exitCode = added.length || stale.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    run();
  } catch (error) {
    report('error', error.message);
    process.exitCode = 1;
  }
}
