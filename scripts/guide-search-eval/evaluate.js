#!/usr/bin/env node
/**
 * Live guide-search evaluation (`npm run eval:guide-search`).
 *
 * Runs every case in `cases.json` through the built `find-guides` CLI against
 * the live package catalog, then reports top-three recall and noStrongMatch
 * correctness. Exits non-zero when either falls below its threshold.
 *
 * On demand only: it needs the network and the catalog changes under it, so it
 * is not part of `npm test` or any PR check. The PR-blocking ranking tests run
 * offline over a synthetic fixture in `src/cli/utils/guide-search/__tests__/`.
 *
 *   npm run eval:guide-search
 *   PATHFINDER_REPOSITORY_URL=https://example.test/packages/ npm run eval:guide-search
 *   node scripts/guide-search-eval/evaluate.js --json   # machine-readable report
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const MIN_TOP_THREE_RECALL = 0.9;
const MIN_NO_ANSWER_CORRECT = 1;
const CONCURRENCY = 4;
const DEFAULT_REPOSITORY_URL = 'https://interactive-learning.grafana.net/packages/';

const ROOT = path.resolve(__dirname, '../..');
const CLI = path.join(ROOT, 'dist/cli/cli/index.js');
const CASES = JSON.parse(fs.readFileSync(path.join(__dirname, 'cases.json'), 'utf8'));

function cliArgs(request) {
  const args = [CLI, '--format', 'json', 'find-guides', '--limit', '5'];
  for (const query of request.queries ?? []) {
    args.push('--queries', query);
  }
  for (const category of request.categories ?? []) {
    args.push('--categories', category);
  }
  for (const id of request.excludeIds ?? []) {
    args.push('--exclude-ids', id);
  }
  if (request.pageUrl) {
    args.push('--page-url', request.pageUrl);
  }
  if (request.type) {
    args.push('--type', request.type);
  }
  if (request.platform) {
    args.push('--platform', request.platform);
  }
  return args;
}

function runCase(testCase) {
  return new Promise((resolve) => {
    execFile(process.execPath, cliArgs(testCase.request), { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        resolve({ testCase, error: (stderr || error.message).trim() });
        return;
      }
      try {
        resolve({ testCase, data: JSON.parse(stdout).data });
      } catch (parseError) {
        resolve({ testCase, error: `unparseable CLI output: ${parseError.message}` });
      }
    });
  });
}

async function runAll(cases) {
  const results = new Array(cases.length);
  let next = 0;
  async function worker() {
    while (next < cases.length) {
      const i = next++;
      results[i] = await runCase(cases[i]);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return results;
}

async function fetchParents() {
  const base = (process.env.PATHFINDER_REPOSITORY_URL || DEFAULT_REPOSITORY_URL).replace(/\/?$/, '/');
  const response = await fetch(`${base}repository.json`);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} fetching ${base}repository.json`);
  }
  const catalog = await response.json();
  const parents = new Map();
  for (const [id, entry] of Object.entries(catalog)) {
    for (const step of Array.isArray(entry.milestones) ? entry.milestones : []) {
      parents.set(step, [...(parents.get(step) ?? []), id]);
    }
  }
  return { base, known: new Set(Object.keys(catalog)), parents };
}

function grade(outcome, catalog) {
  const { testCase, data, error } = outcome;
  if (error) {
    return { name: testCase.name, ok: false, detail: `error: ${error}` };
  }
  if (!testCase.expect) {
    const top = data.results.map((r) => `${r.id}:${r.relevance}`).join(', ');
    return { name: testCase.name, ok: data.noStrongMatch === true, detail: top || '(no results)' };
  }
  const covered = data.results.slice(0, 3).flatMap((r) => [r.id, ...(r.matchedSteps ?? []).map((s) => s.id)]);
  const accepts = (id) => covered.includes(id) || (catalog.parents.get(id) ?? []).some((p) => covered.includes(p));
  const missing = testCase.expect.filter((id) => !catalog.known.has(id));
  return {
    name: testCase.name,
    ok: testCase.expect.some(accepts),
    topStrong: data.results[0]?.relevance === 'strong',
    detail: `top 3: ${
      data.results
        .slice(0, 3)
        .map((r) => r.id)
        .join(', ') || '(none)'
    }${missing.length > 0 ? ` | not in live catalog: ${missing.join(', ')}` : ''}`,
  };
}

async function main() {
  if (!fs.existsSync(CLI)) {
    console.error(`Built CLI not found at ${path.relative(ROOT, CLI)}. Run \`npm run build:cli\` first.`);
    process.exit(2);
  }
  const catalog = await fetchParents();
  const outcomes = await runAll(CASES);
  const catalogVersion = outcomes.find((o) => o.data?.catalogVersion)?.data.catalogVersion;
  const graded = outcomes.map((o) => grade(o, catalog));
  const positive = graded.filter((g, i) => CASES[i].expect);
  const noAnswer = graded.filter((g, i) => !CASES[i].expect);
  const recall = positive.filter((g) => g.ok).length / positive.length;
  const noAnswerCorrect = noAnswer.length === 0 ? 1 : noAnswer.filter((g) => g.ok).length / noAnswer.length;
  const topStrong = positive.filter((g) => g.topStrong).length;
  const passed = recall >= MIN_TOP_THREE_RECALL && noAnswerCorrect >= MIN_NO_ANSWER_CORRECT;

  const report = {
    repository: catalog.base,
    catalogVersion,
    cases: CASES.length,
    topThreeRecall: {
      hits: positive.filter((g) => g.ok).length,
      of: positive.length,
      value: recall,
      min: MIN_TOP_THREE_RECALL,
    },
    noStrongMatchCorrect: {
      hits: noAnswer.filter((g) => g.ok).length,
      of: noAnswer.length,
      value: noAnswerCorrect,
      min: MIN_NO_ANSWER_CORRECT,
    },
    topResultStrong: {
      hits: topStrong,
      of: positive.length,
      partial: positive.filter((g) => g.ok && !g.topStrong).map((g) => g.name),
    },
    misses: graded.filter((g) => !g.ok).map(({ name, detail }) => ({ name, detail })),
    passed,
  };

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const pct = (value) => `${(value * 100).toFixed(1)}%`;
    console.log(`Repository: ${report.repository} (catalog version ${catalogVersion ?? 'unknown'})`);
    console.log(`Cases: ${report.cases}`);
    console.log(
      `Top-three recall: ${report.topThreeRecall.hits}/${report.topThreeRecall.of} (${pct(recall)}; minimum ${pct(MIN_TOP_THREE_RECALL)})`
    );
    console.log(
      `noStrongMatch on no-answer cases: ${report.noStrongMatchCorrect.hits}/${report.noStrongMatchCorrect.of} (${pct(noAnswerCorrect)}; minimum ${pct(MIN_NO_ANSWER_CORRECT)})`
    );
    console.log(
      `Top result labelled strong: ${topStrong}/${positive.length} (informational; partial: ${report.topResultStrong.partial.join(', ') || 'none'})`
    );
    for (const miss of report.misses) {
      console.log(`  MISS ${miss.name}: ${miss.detail}`);
    }
    console.log(passed ? 'PASS' : 'FAIL');
  }
  process.exit(passed ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
});
