import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, matchesGlob, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractConcernContext, validateConcernRegistry } from '../../../review-shared/concern-context.mjs';
import { findTable, unquote } from '../../../review-shared/registry-table.mjs';
import { deltaTriggers, isTestPath, scanSync } from './sync-scan.mjs';

export const STATE_VERSION = 'review-lite-v1';
export const INITIAL_CONTEXT_BUDGET = 12_000;

const TOOLING_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const ALL_FILES_SENTINEL = 'all changed files';
const LARGE_FILE_LINES = 400;
// Between the heaviest in-full test load of the passing lite-v3 runs (882, #1971) and #2018's 1648 across 26 files.
export const TEST_LINE_BUDGET = 1200;
const GENERATED_PATTERNS = [
  '**/package-lock.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml',
  '**/go.sum',
  '**/*.snap',
  '**/*.min.js',
  'dist/**',
  '**/__generated__/**',
  '**/*.generated.*',
];
const FINDING_ID = /^[A-Za-z][A-Za-z0-9-]{0,31}$/;
const COMMIT_SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const MAX_NITS = 5;
const MAX_READ_BYTES = 30_000;
const REVISION_PIN = /^(?:[0-9a-f]{7,64}|v?\d+(?:\.\d+)+(?:-[0-9A-Za-z.]+)?)$/;
const TEST_SCOPES = ['full', 'changed_hunks'];
const UNREAD_KINDS = ['binary', 'generated', 'not_in_head', 'tooling_blocked'];
const EFFORT_REASON = /\b(effort|save time|to save|too (large|big|long|many)|large file|big file|budget|cost)\b/i;
const ATTRIBUTIONS = ['introduced', 'newly_exposed', 'pre_existing'];
const GOVERNING_KINDS = ['normative_spec', 'external_schema', 'fixture_contract'];
const RISK_METHODS = ['targeted_test', 'probe', 'mutation', 'contract_comparison', 'static_trace'];
const DEFERRED_BASES = ['pre_existing', 'accepted_scope', 'late_round_convergence'];
const BASE_PATH_LINE = /[\w@./-]+\.[A-Za-z0-9]+:\d+/;
const NIT_TEXT_FIELDS = ['title', 'location', 'evidence'];
const PLACEHOLDER_REASONS = new Set(['', 'n/a', 'na', 'none', 'not applicable', '-', 'no', 'nothing']);

export class UsageError extends Error {}

const HELP = {
  prepare: `Usage: review-lite.mjs prepare --repo DIR --base REV --head REV --review-key KEY --round N --out DIR [--prior FILE] [--knowledge DIR]

Resolves the base and head commits in the target repository, inventories the merge-base-to-head
diff, copies the concern registries from the trusted tooling checkout (or --knowledge DIR), and
writes routing candidates plus the always-on checklist into a new, empty run directory.
--prior takes state.json from an earlier trusted review-lite run; it enables incremental review
when the review key, comparison base, and registries match and the reviewed head is an ancestor.
--round is the positive review round, independent of full or incremental inspection.

Example:
  node .cursor/skills/review-lite/scripts/review-lite.mjs prepare \\
    --repo /abs/target-repo --base 1a2b3c4 --head 5d6e7f8 \\
    --review-key grafana/grafana-pathfinder-app#123 --round 1 --out /abs/runs/pr-123-r1`,
  context: `Usage: review-lite.mjs context --run DIR --concerns ID[,ID...] [--governing FILE] [--risk FILE]

Writes compact packets for the named concerns into DIR/context/ and records them as selected.
Any concern in the run's registry may be requested, not only the routing candidates. --governing
adds reviewer-discovered material inputs (a JSON array of {id, kind, source, reason}) as required
inspection obligations; --risk adds reviewer-discovered risky behavior (a JSON array of {id, category, reason}).
Use them for a PR-cited RFC, an unchanged contract anchor, or a risk the bounded scan missed.

Example:
  node .cursor/skills/review-lite/scripts/review-lite.mjs context \\
    --run /abs/runs/pr-123-r1 --concerns interactive-engine,requirements-manager`,
  read: `Usage: review-lite.mjs read --run DIR --path REPOSITORY_PATH --scope full|changed_hunks [--range START:END]

Reads at most 200 pinned-head lines and records exactly what the helper delivered. Without --range,
it starts at the first required range. Use the returned next range until all required ranges are read.
Use changed_hunks only for a scope allowed by the test-size rule; a deletion-only hunk includes adjacent head lines.

Example:
  node .cursor/skills/review-lite/scripts/review-lite.mjs read \\
    --run /abs/runs/pr-123-r1 --path src/engine/runner.test.ts --scope changed_hunks`,
  finish: `Usage: review-lite.mjs finish --run DIR --input FILE

Validates the reviewer's result object (see references/result-format.md), then writes
DIR/report.md and, for a complete assessment, DIR/state.json for the next round.

Example:
  node .cursor/skills/review-lite/scripts/review-lite.mjs finish \\
    --run /abs/runs/pr-123-r1 --input /abs/runs/pr-123-r1/result.json`,
};

const FLAGS = {
  prepare: { required: ['repo', 'base', 'head', 'review-key', 'round', 'out'], optional: ['prior', 'knowledge'] },
  context: { required: ['run', 'concerns'], optional: ['governing', 'risk'] },
  read: { required: ['run', 'path', 'scope'], optional: ['range'] },
  finish: { required: ['run', 'input'], optional: [] },
};
const PATH_FLAGS = new Set(['repo', 'out', 'prior', 'knowledge', 'run', 'input', 'governing', 'risk']);

function topHelp() {
  return `Usage: review-lite.mjs <prepare|context|read|finish> [options]\n\n${Object.values(HELP).join('\n\n')}`;
}

export function parseArgs(command, argv) {
  const spec = FLAGS[command];
  if (!spec) {
    throw new UsageError(`Unknown command ${JSON.stringify(command)}.\n\n${topHelp()}`);
  }
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const name = flag.startsWith('--') ? flag.slice(2) : null;
    if (!name || ![...spec.required, ...spec.optional].includes(name)) {
      throw new UsageError(`Unknown option ${JSON.stringify(flag)}.\n\n${HELP[command]}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new UsageError(`Option --${name} needs a value.\n\n${HELP[command]}`);
    }
    if (PATH_FLAGS.has(name) && !isAbsolute(value)) {
      throw new UsageError(`Option --${name} must be an absolute path; got ${JSON.stringify(value)}.`);
    }
    options[name] = value;
  }
  const missing = spec.required.filter((name) => options[name] === undefined);
  if (missing.length > 0) {
    throw new UsageError(`Missing ${missing.map((name) => `--${name}`).join(', ')}.\n\n${HELP[command]}`);
  }
  return options;
}

function git(repo, args, { allowFailure = false } = {}) {
  try {
    return execFileSync('git', ['-C', repo, '-c', 'core.quotePath=false', ...args], {
      encoding: 'utf8',
      maxBuffer: 512 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    if (allowFailure) {
      return null;
    }
    const stderr = error.stderr ? String(error.stderr).trim() : error.message;
    throw new Error(`git ${args[0]} failed in ${repo}: ${stderr}`);
  }
}

function resolveCommit(repo, revision, label) {
  if (!revision || revision.startsWith('-')) {
    throw new UsageError(`--${label} must name a revision, not an option: ${JSON.stringify(revision)}`);
  }
  const sha = git(repo, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${revision}^{commit}`], {
    allowFailure: true,
  });
  if (!sha) {
    throw new Error(
      `Cannot resolve --${label} ${JSON.stringify(revision)} to a commit in ${repo}. Fetch it first; the working tree is never used instead.`
    );
  }
  return sha.trim();
}

function isAncestor(repo, ancestor, descendant) {
  return git(repo, ['merge-base', '--is-ancestor', ancestor, descendant], { allowFailure: true }) !== null;
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(path, label) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`Cannot read ${label} at ${path}.`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} at ${path} is not valid JSON: ${error.message}`);
  }
}

function splitNul(output) {
  const tokens = output.split('\0');
  if (tokens.at(-1) === '') {
    tokens.pop();
  }
  return tokens;
}

function parseNameStatus(output) {
  const tokens = splitNul(output);
  const files = [];
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index];
    const code = status[0];
    if (code === 'R' || code === 'C') {
      files.push({
        status: code,
        similarity: Number(status.slice(1)),
        old_path: tokens[index + 1],
        path: tokens[index + 2],
      });
      index += 3;
    } else {
      files.push({ status: code, path: tokens[index + 1] });
      index += 2;
    }
  }
  return files;
}

function parseNumstat(output) {
  const tokens = splitNul(output);
  const stats = new Map();
  for (let index = 0; index < tokens.length;) {
    const [added, deleted, inlinePath] = tokens[index].split('\t');
    let path = inlinePath;
    index += 1;
    if (inlinePath === '') {
      path = tokens[index + 1];
      index += 2;
    }
    stats.set(
      path,
      added === '-' ? { binary: true } : { binary: false, added: Number(added), deleted: Number(deleted) }
    );
  }
  return stats;
}

function diffLines(repo, from, to, file) {
  const paths = file.old_path ? [file.old_path, file.path] : [file.path];
  const patch = git(repo, [
    'diff',
    '--no-ext-diff',
    '--no-textconv',
    '--no-color',
    '-M',
    '-U0',
    from,
    to,
    '--',
    ...paths,
  ]);
  const lines = [];
  let inHunk = false;
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      inHunk = false;
    } else if (line.startsWith('@@')) {
      inHunk = true;
    } else if (inHunk && (line.startsWith('+') || line.startsWith('-'))) {
      lines.push({ sign: line[0], text: line.slice(1) });
    }
  }
  return lines;
}

function changedLineRanges(repo, from, to, file) {
  const paths = file.old_path ? [file.old_path, file.path] : [file.path];
  const patch = git(repo, [
    'diff',
    '--no-ext-diff',
    '--no-textconv',
    '--no-color',
    '-M',
    '-U0',
    from,
    to,
    '--',
    ...paths,
  ]);
  const headLines = lineCount(git(repo, ['show', `${to}:${file.path}`], { allowFailure: true }) ?? '');
  const ranges = [];
  for (const line of patch.split('\n')) {
    const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (!match) {
      continue;
    }
    const oldStart = Number(match[1]);
    const oldCount = match[2] === undefined ? 1 : Number(match[2]);
    const start = Number(match[3]);
    const count = match[4] === undefined ? 1 : Number(match[4]);
    if (count > 0) {
      ranges.push({ start, end: start + count - 1 });
    } else if (headLines > 0) {
      const nearbyStart = Math.max(1, Math.min(start - 1, headLines));
      ranges.push({ start: nearbyStart, end: Math.min(headLines, start + 1) });
    } else if (oldCount > 0) {
      ranges.push({ start: oldStart, end: oldStart + oldCount - 1, revision: 'base' });
    }
  }
  return ranges;
}

function isReviewableSource(file) {
  return !file.binary && !isTestPath(file.path) && !file.path.startsWith('docs/') && !file.path.startsWith('.cursor/');
}

function governingInputCandidates(files, diffs) {
  const candidates = [];
  for (const file of files.filter(isReviewableSource)) {
    const text = (diffs.get(file.path) ?? []).map(({ text: line }) => line).join('\n');
    const fixture =
      /(?:^|\/)(?:fixtures?|testdata)(?:\/|$)|(?:contract|schema|openapi|crd)[^/]*\.(?:json|ya?ml)$/i.test(file.path);
    const normative = /\b(?:RFC|OpenAPI|CRD|specification|contract\s+(?:spec|fixture|schema))\b/i.test(text);
    if (!fixture && !normative) {
      continue;
    }
    candidates.push({
      id: `governing:${candidates.length}`,
      obligation: 'governing_input',
      kind:
        /\b(?:OpenAPI|CRD)\b/i.test(text) || /(?:openapi|crd)/i.test(file.path)
          ? 'external_schema'
          : fixture
            ? 'fixture_contract'
            : 'normative_spec',
      path: file.path,
      reason: fixture
        ? 'Changed fixture or contract-shaped artifact; compare it with the source that defines the deployed contract.'
        : 'Changed text names a governing specification or contract; decide whether it defines this behavior.',
    });
  }
  return candidates;
}

function riskCandidates(files, diffs) {
  const patterns = [
    ['persistence', /\b(?:persist|save|store|record|migration)\w*/i],
    ['trust-boundary', /\b(?:auth|authoriz|permission|token|identity|credential)\w*/i],
    ['compatibility', /\b(?:compatib|schema|contract|version|migration)\w*/i],
    ['irreversible-effect', /\b(?:delete|irreversible|publish|award|charge)\w*/i],
    ['error-retry', /\b(?:retry|backoff|conflict|retryable|attempt)\w*/i],
  ];
  const candidates = [];
  for (const [category, pattern] of patterns) {
    const paths = files
      .filter(isReviewableSource)
      .filter((file) => (diffs.get(file.path) ?? []).some(({ text }) => pattern.test(text)))
      .map((file) => file.path);
    if (paths.length > 0) {
      candidates.push({
        id: `risk:${category}`,
        obligation: 'risk_verification',
        category,
        paths,
        reason: `Changed code has ${category.replace('-', ' ')} signals. Decide whether a discriminating verification is needed.`,
      });
    }
  }
  return candidates;
}

export function inventoryDiff(repo, from, to) {
  const diffArgs = ['diff', '--no-ext-diff', '--no-textconv', '-M', '-z'];
  const files = parseNameStatus(git(repo, [...diffArgs, '--name-status', from, to]));
  const stats = parseNumstat(git(repo, [...diffArgs, '--numstat', from, to]));
  return files.map((file) => {
    const stat = stats.get(file.path) ?? { binary: false, added: 0, deleted: 0 };
    const generated = [file.path, file.old_path].some(
      (path) => path && GENERATED_PATTERNS.some((pattern) => matchesGlob(path, pattern))
    );
    const targeted = [];
    if (stat.binary) {
      targeted.push('binary: inspect the blob directly; no text hunks were scanned');
    }
    if (generated) {
      targeted.push('generated or lock file: inspect the generator input or a targeted sample');
    }
    if (!stat.binary && stat.added + stat.deleted > LARGE_FILE_LINES) {
      targeted.push(`large change: ${stat.added + stat.deleted} lines`);
    }
    return { ...file, ...stat, generated, targeted_inspection: targeted };
  });
}

function savePatch(repo, from, to, path) {
  writeFileSync(path, git(repo, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '-M', from, to]));
}

function readRegistry(root) {
  const routingMarkdown = readFileSync(join(root, 'registry', 'CONCERNS.md'), 'utf8');
  const detailMarkdown = readFileSync(join(root, 'registry', 'CONCERN_DETAILS.md'), 'utf8');
  return { routingMarkdown, detailMarkdown };
}

function loadKnowledge(knowledgeRoot) {
  const read = (name) => {
    const path = join(knowledgeRoot, 'docs', 'design', name);
    if (!existsSync(path)) {
      throw new Error(`Concern registry ${path} does not exist. Point --knowledge at a trusted checkout.`);
    }
    return readFileSync(path, 'utf8');
  };
  const registry = { routingMarkdown: read('CONCERNS.md'), detailMarkdown: read('CONCERN_DETAILS.md') };
  const errors = validateConcernRegistry(registry);
  if (errors.length > 0) {
    throw new Error(`Concern registry at ${knowledgeRoot} is invalid:\n- ${errors.join('\n- ')}`);
  }
  return registry;
}

function knowledgeIdentity(knowledgeRoot, registry) {
  const revision = git(knowledgeRoot, ['rev-parse', 'HEAD'], { allowFailure: true })?.trim() ?? null;
  const status =
    revision === null
      ? null
      : git(
          knowledgeRoot,
          ['status', '--porcelain', '--', 'docs/design/CONCERNS.md', 'docs/design/CONCERN_DETAILS.md'],
          {
            allowFailure: true,
          }
        );
  return {
    tooling_revision: revision,
    registry_modified_in_checkout: status === null ? null : status.trim().length > 0,
    concerns_sha256: sha256(registry.routingMarkdown),
    details_sha256: sha256(registry.detailMarkdown),
  };
}

export function concernIds(registry) {
  return findTable(registry.routingMarkdown, ['id', 'trigger_paths', 'trigger_keywords']).map((row) => ({
    id: unquote(row.id),
    alwaysOn: row.cat === 'AO',
  }));
}

function pathMatches(file, pattern) {
  if (pattern === ALL_FILES_SENTINEL) {
    return true;
  }
  return [file.path, file.old_path].some((path) => path && matchesGlob(path, pattern));
}

export function routeCandidates(registry, files, linesByPath) {
  const candidates = [];
  const routed = new Set();
  for (const { id, alwaysOn } of concernIds(registry)) {
    if (alwaysOn) {
      continue;
    }
    const context = extractConcernContext({ ...registry, concern: id });
    const pathFiles = files.filter((file) => context.trigger_paths.some((pattern) => pathMatches(file, pattern)));
    const keywordHits = context.trigger_keywords
      .map((keyword) => ({
        keyword,
        files: files
          .filter((file) => (linesByPath.get(file.path) ?? []).some((line) => line.includes(keyword)))
          .map((file) => file.path),
      }))
      .filter((hit) => hit.files.length > 0);
    if (pathFiles.length === 0 && keywordHits.length === 0) {
      continue;
    }
    for (const file of pathFiles) {
      routed.add(file.path);
    }
    for (const hit of keywordHits) {
      hit.files.forEach((path) => routed.add(path));
    }
    candidates.push({
      id,
      category: context.category,
      min_signals: context.activation.min_signals,
      lexical_evidence: [pathFiles.length > 0 && 'path', keywordHits.length > 0 && 'keyword'].filter(Boolean).join('+'),
      path_files: pathFiles.map((file) => file.path),
      keyword_hits: keywordHits,
      related: context.related.filter((related) => related !== 'all¹'),
    });
  }
  const rank = { 'path+keyword': 0, keyword: 1, path: 2 };
  candidates.sort(
    (left, right) =>
      rank[left.lexical_evidence] - rank[right.lexical_evidence] ||
      right.keyword_hits.length - left.keyword_hits.length ||
      (left.id < right.id ? -1 : 1)
  );
  const candidateIds = new Set(candidates.map(({ id }) => id));
  const expandable = [...new Set(candidates.flatMap(({ related }) => related))].filter((id) => !candidateIds.has(id));
  return {
    note: 'Lexical candidates only. A path or keyword hit nominates a concern; it does not show the concern applies, and a miss does not show coverage is complete.',
    candidates,
    expandable_related: expandable.sort(),
    unrouted_files: files.filter((file) => !routed.has(file.path)).map((file) => file.path),
  };
}

function contractText(text) {
  return String(text).replace(/<br\s*\/?>/g, '\n');
}

function bulletList(items) {
  return items.map((item) => `- ${item}`).join('\n');
}

function pointerLine(context, seen) {
  const fresh = (values) => values.filter((value) => !seen.has(value));
  const docs = fresh(context.load_docs);
  const code = fresh(context.load_code);
  return [docs.length && `docs: ${docs.join(', ')}`, code.length && `code: ${code.join(', ')}`]
    .filter(Boolean)
    .join('; ');
}

function contractSections(context) {
  const sections = [];
  if (context.contract_anchor) {
    sections.push(`Contract:\n${contractText(context.contract_anchor.contract)}`);
  }
  if (context.named_invariants.length > 0) {
    sections.push(
      `Named invariants:\n${bulletList(context.named_invariants.map(({ name, invariant }) => `**${name}**: ${invariant}`))}`
    );
  }
  if (context.pre_contract_candidate) {
    sections.push(
      `Pre-contract candidate (not yet a contract): ${context.pre_contract_candidate.evidence} (proposed owner: ${context.pre_contract_candidate.proposed_owner})`
    );
  }
  return sections;
}

export function renderAlwaysOnChecklist(registry) {
  const contexts = concernIds(registry)
    .filter(({ alwaysOn }) => alwaysOn)
    .map(({ id }) => extractConcernContext({ ...registry, concern: id }));
  const pointers = new Set();
  const verification = new Set();
  const blocks = contexts.map((context) => {
    context.load_docs.forEach((value) => pointers.add(value));
    context.verification.forEach((value) => verification.add(value));
    return [
      `## ${context.id}`,
      context.purpose,
      bulletList(context.review_questions),
      context.one_way_doors.length > 0 ? `One-way doors: ${context.one_way_doors.join('; ')}` : '',
      ...contractSections(context),
    ]
      .filter(Boolean)
      .join('\n\n');
  });
  const text = [
    '# Always-on checklist',
    `Selected automatically. Record coverage for each ID: ${contexts.map(({ id }) => `\`${id}\``).join(', ')}.`,
    ...blocks,
    `## Shared pointers\n\nRead when a question above needs them: ${[...pointers].join(', ')}.\n\nVerification expected across concerns: ${[...verification].join('; ')}.`,
  ].join('\n\n');
  return {
    ids: contexts.map(({ id }) => id),
    text: `${text}\n`,
    seen: new Set([...pointers, ...contexts.flatMap((c) => c.review_questions)]),
  };
}

export function renderConcernPacket(context, seen) {
  const questions = context.review_questions.filter((question) => !seen.has(question));
  const pointers = pointerLine(context, seen);
  return `${[
    `# ${context.id} (${context.category})`,
    context.purpose,
    questions.length > 0 ? `Review questions:\n${bulletList(questions)}` : '',
    ...contractSections(context),
    context.one_way_doors.length > 0 ? `One-way doors:\n${bulletList(context.one_way_doors)}` : '',
    pointers ? `Context pointers: ${pointers}` : '',
    context.verification.length > 0 ? `Verification: ${context.verification.join('; ')}` : '',
    context.related.length > 0 ? `Related concerns: ${context.related.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')}\n`;
}

function requireString(errors, value, label, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && value.trim() === '')) {
    errors.push(`${label} must be a ${allowEmpty ? '' : 'non-empty '}string`);
    return false;
  }
  return true;
}

function requireArray(errors, value, label) {
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array`);
    return [];
  }
  return value;
}

const FINDING_TEXT_FIELDS = ['title', 'location', 'evidence', 'consequence', 'base_comparison'];

function validateFindingRecord(errors, finding, label, knownConcerns, { strict = false, round } = {}) {
  if (!finding || typeof finding !== 'object') {
    errors.push(`${label} must be an object`);
    return;
  }
  if (typeof finding.id !== 'string' || !FINDING_ID.test(finding.id)) {
    errors.push(`${label}.id must match ${FINDING_ID}`);
  }
  if (!knownConcerns.has(finding.concern_id)) {
    errors.push(`${label}.concern_id ${JSON.stringify(finding.concern_id)} is not a known concern`);
  }
  const optional = strict && ['nit', 'suggestion'].includes(finding.disposition);
  for (const field of optional ? NIT_TEXT_FIELDS : FINDING_TEXT_FIELDS) {
    requireString(errors, finding[field], `${label}.${field}`);
  }
  if (finding.disposition === 'blocker') {
    requireString(errors, finding.required_invariant, `${label}.required_invariant (required for a blocker)`);
    requireString(errors, finding.merge_reason, `${label}.merge_reason (required for a blocker)`);
  } else if (finding.disposition === 'separate_work' || (!strict && finding.disposition === 'follow_up')) {
    const legacy = finding.disposition === 'follow_up';
    requireString(
      errors,
      finding.next_action,
      `${label}.next_action (required for ${legacy ? 'a legacy follow-up' : 'separate work'})`
    );
    if (strict && !ATTRIBUTIONS.includes(finding.attribution)) {
      errors.push(`${label}.attribution must be one of ${ATTRIBUTIONS.join(', ')} (required for separate work)`);
    }
    if (
      strict &&
      finding.attribution === 'pre_existing' &&
      !BASE_PATH_LINE.test(String(finding.base_comparison ?? ''))
    ) {
      errors.push(
        `${label}.base_comparison must cite the base code as path:line for pre_existing separate work and say whether the PR changed what that path does to stored state; a bare "same as base" is rejected`
      );
    }
    if (strict) {
      requireString(
        errors,
        finding.deferral_reason,
        `${label}.deferral_reason (required for separate work: explain why it belongs outside this merge)`
      );
      if (!DEFERRED_BASES.includes(finding.deferral_basis)) {
        errors.push(`${label}.deferral_basis must be one of ${DEFERRED_BASES.join(', ')}`);
      } else if (finding.deferral_basis === 'pre_existing' && finding.attribution !== 'pre_existing') {
        errors.push(`${label}.deferral_basis pre_existing requires attribution pre_existing`);
      } else if (finding.deferral_basis === 'accepted_scope') {
        requireString(errors, finding.scope_decision, `${label}.scope_decision (the accepted scope boundary)`);
      } else if (finding.deferral_basis === 'late_round_convergence' && (!Number.isSafeInteger(round) || round < 3)) {
        errors.push(`${label}.deferral_basis late_round_convergence is only available in round 3 or later`);
      }
    }
  } else if (optional) {
    requireString(
      errors,
      finding.next_action,
      `${label}.next_action (the suggested change, required for a ${finding.disposition})`
    );
  } else {
    errors.push(
      `${label}.disposition must be ${strict ? 'blocker, separate_work, suggestion, or nit' : 'blocker, separate_work, or follow_up'}`
    );
  }
  for (const field of [
    'required_invariant',
    'merge_reason',
    'next_action',
    'deferral_reason',
    'deferral_basis',
    'scope_decision',
    'why_not_blocker',
  ]) {
    if (finding[field] !== undefined && typeof finding[field] !== 'string') {
      errors.push(`${label}.${field} must be a string when present`);
    }
  }
}

function validateClearanceRecord(errors, clearance, label, knownConcerns) {
  if (!clearance || typeof clearance !== 'object') {
    errors.push(`${label} must be an object`);
    return;
  }
  if (typeof clearance.id !== 'string' || !FINDING_ID.test(clearance.id)) {
    errors.push(`${label}.id must match ${FINDING_ID}`);
  }
  if (!knownConcerns.has(clearance.concern_id)) {
    errors.push(`${label}.concern_id ${JSON.stringify(clearance.concern_id)} is not a known concern`);
  }
  requireString(errors, clearance.claim, `${label}.claim`);
  requireString(errors, clearance.evidence, `${label}.evidence`);
}

export function validateState(state) {
  const errors = [];
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return ['state must be an object'];
  }
  if (state.version !== STATE_VERSION) {
    return [`state.version must be ${STATE_VERSION}; got ${JSON.stringify(state.version)}`];
  }
  requireString(errors, state.review_key, 'state.review_key');
  if (state.round !== undefined && (!Number.isSafeInteger(state.round) || state.round < 1)) {
    errors.push('state.round must be a positive safe integer when present');
  }
  for (const field of ['reviewed_head', 'base', 'merge_base']) {
    if (typeof state[field] !== 'string' || !COMMIT_SHA.test(state[field])) {
      errors.push(`state.${field} must be a full commit SHA`);
    }
  }
  for (const field of ['concerns_sha256', 'details_sha256']) {
    if (typeof state.registry?.[field] !== 'string' || !/^[0-9a-f]{64}$/.test(state.registry[field])) {
      errors.push(`state.registry.${field} must be a SHA-256 hex digest`);
    }
  }
  const anyConcern = { has: (value) => typeof value === 'string' && /^[a-z0-9-]+$/.test(value) };
  const ids = new Set();
  requireArray(errors, state.findings, 'state.findings').forEach((finding, index) => {
    validateFindingRecord(errors, finding, `state.findings[${index}]`, anyConcern);
    if (ids.has(finding?.id)) {
      errors.push(`state has duplicate item id ${finding.id}`);
    }
    ids.add(finding?.id);
  });
  requireArray(errors, state.clearances, 'state.clearances').forEach((clearance, index) => {
    validateClearanceRecord(errors, clearance, `state.clearances[${index}]`, anyConcern);
    if (ids.has(clearance?.id)) {
      errors.push(`state has duplicate item id ${clearance.id}`);
    }
    ids.add(clearance?.id);
  });
  return errors;
}

export function assessPrior({ repo, priorPath, reviewKey, head, mergeBase, registry }) {
  if (!priorPath) {
    return { status: 'none', mode: 'full', items: [] };
  }
  let state;
  try {
    state = readJson(priorPath, 'prior state');
  } catch (error) {
    return { status: 'untrusted', mode: 'full', reason: error.message, items: [] };
  }
  const errors = validateState(state);
  if (errors.length > 0) {
    return { status: 'untrusted', mode: 'full', reason: `prior state is invalid: ${errors.join('; ')}`, items: [] };
  }
  if (state.review_key !== reviewKey) {
    return {
      status: 'untrusted',
      mode: 'full',
      reason: `prior state belongs to ${JSON.stringify(state.review_key)}, not ${JSON.stringify(reviewKey)}`,
      items: [],
    };
  }
  const items = [
    ...state.findings.map((finding) => ({ kind: 'finding', ...finding })),
    ...state.clearances.map((clearance) => ({ kind: 'clearance', ...clearance })),
  ];
  const trusted = { status: 'trusted', reviewed_head: state.reviewed_head, items };
  const known = git(repo, ['cat-file', '-e', `${state.reviewed_head}^{commit}`], { allowFailure: true }) !== null;
  if (!known || !isAncestor(repo, state.reviewed_head, head)) {
    return {
      ...trusted,
      mode: 'full',
      reason: 'the previously reviewed head is not an ancestor of the current head (rewritten or unknown history)',
    };
  }
  if (state.merge_base !== mergeBase) {
    return { ...trusted, mode: 'full', reason: `the comparison base changed from ${state.merge_base} to ${mergeBase}` };
  }
  if (
    state.registry.concerns_sha256 !== registry.concerns_sha256 ||
    state.registry.details_sha256 !== registry.details_sha256
  ) {
    return { ...trusted, mode: 'full', reason: 'the concern registry changed since the prior review' };
  }
  return { ...trusted, mode: 'incremental' };
}

export function prepare(options) {
  const { repo, out } = options;
  const round = Number(options.round);
  if (!Number.isSafeInteger(round) || round < 1) {
    throw new UsageError('--round must be a positive safe integer.');
  }
  if (existsSync(out) && readdirSync(out).length > 0) {
    throw new Error(`Run directory ${out} is not empty. Use a new directory for each preparation.`);
  }
  if (git(repo, ['rev-parse', '--git-dir'], { allowFailure: true }) === null) {
    throw new Error(`${repo} is not a Git repository.`);
  }
  const base = resolveCommit(repo, options.base, 'base');
  const head = resolveCommit(repo, options.head, 'head');
  const mergeBaseOutput = git(repo, ['merge-base', base, head], { allowFailure: true });
  if (!mergeBaseOutput) {
    throw new Error(`Base ${base} and head ${head} share no merge base.`);
  }
  const mergeBase = mergeBaseOutput.trim();
  const knowledgeRoot = options.knowledge ?? TOOLING_ROOT;
  const registry = loadKnowledge(knowledgeRoot);
  const registryIdentity = knowledgeIdentity(knowledgeRoot, registry);
  const prior = assessPrior({
    repo,
    priorPath: options.prior,
    reviewKey: options['review-key'],
    head,
    mergeBase,
    registry: registryIdentity,
  });

  mkdirSync(join(out, 'registry'), { recursive: true });
  mkdirSync(join(out, 'context'), { recursive: true });
  writeFileSync(join(out, 'registry', 'CONCERNS.md'), registry.routingMarkdown);
  writeFileSync(join(out, 'registry', 'CONCERN_DETAILS.md'), registry.detailMarkdown);

  const files = inventoryDiff(repo, mergeBase, head);
  savePatch(repo, mergeBase, head, join(out, 'changes.patch'));
  const artifacts = {
    inventory: 'inventory.json',
    patch: 'changes.patch',
    candidates: 'candidates.json',
    sync_hits: 'sync-hits.json',
    delta_triggers: 'delta-triggers.json',
    reads: 'reads.json',
    prior: 'prior.json',
    obligations: 'obligations.json',
  };
  let incrementalFiles = null;
  let reviewFiles = files;
  if (prior.mode === 'incremental') {
    savePatch(repo, prior.reviewed_head, head, join(out, 'incremental.patch'));
    reviewFiles = inventoryDiff(repo, prior.reviewed_head, head);
    incrementalFiles = reviewFiles.map((file) => file.path);
    artifacts.incremental_patch = 'incremental.patch';
  }
  const diffs = new Map(
    reviewFiles
      .filter((file) => !file.binary)
      .map((file) => [
        file.path,
        diffLines(repo, prior.mode === 'incremental' ? prior.reviewed_head : mergeBase, head, file),
      ])
  );
  const linesByPath = new Map([...diffs].map(([path, entries]) => [path, entries.map(({ text }) => text)]));
  const routing = routeCandidates(registry, reviewFiles, linesByPath);
  const checklist = renderAlwaysOnChecklist(registry);
  const governingInputs = governingInputCandidates(reviewFiles, diffs);
  const risks = riskCandidates(reviewFiles, diffs);

  writeJson(join(out, 'inventory.json'), { files, review_files: reviewFiles, incremental_files: incrementalFiles });
  writeJson(join(out, 'candidates.json'), routing);
  const sync = scanSync({ git, repo, head, files: reviewFiles, diffs });
  const delta = deltaTriggers({ files: reviewFiles, diffs });
  writeJson(join(out, 'sync-hits.json'), sync);
  writeJson(join(out, 'delta-triggers.json'), delta);
  writeJson(join(out, 'obligations.json'), [
    ...routing.candidates.map(({ id }) => ({ id: `concern:${id}`, concern_id: id })),
    ...sync.hits.flatMap((hit, index) =>
      ['stale-reference', 'doc-line-in-changed-file'].includes(hit.classification)
        ? [{ id: `sync:${index}`, source: `sync-hits.json hits[${index}]` }]
        : []
    ),
    ...sync.doc_gaps.map((_, index) => ({ id: `doc-gap:${index}`, source: `sync-hits.json doc_gaps[${index}]` })),
    ...delta.triggers.map(({ id }) => ({ id: `delta:${id}`, source: 'delta-triggers.json' })),
    ...governingInputs,
    ...risks,
  ]);
  writeJson(join(out, 'reads.json'), []);
  writeJson(join(out, 'prior.json'), prior);
  writeFileSync(join(out, 'context', 'always-on.md'), checklist.text);
  writeJson(join(out, 'selected.json'), {
    always_on: checklist.ids,
    concerns: checklist.ids,
    packets: { 'always-on': 'context/always-on.md' },
  });
  const manifest = {
    version: STATE_VERSION,
    review_key: options['review-key'],
    round,
    base,
    head,
    merge_base: mergeBase,
    mode: prior.mode,
    ...(prior.mode === 'incremental' ? { incremental_from: prior.reviewed_head } : {}),
    ...(prior.reason ? { fallback_reason: prior.reason } : {}),
    prior_status: prior.status,
    registry: registryIdentity,
    target_repo: repo,
    files_changed: files.length,
    artifacts,
  };
  writeJson(join(out, 'manifest.json'), manifest);
  return { manifest, routing, files, sync, delta, governingInputs, risks, checklistCharacters: checklist.text.length };
}

function readRun(run) {
  if (!existsSync(join(run, 'manifest.json'))) {
    throw new Error(`${run} is not a prepared review-lite run (manifest.json is missing).`);
  }
  return {
    manifest: readJson(join(run, 'manifest.json'), 'run manifest'),
    obligations: readJson(join(run, 'obligations.json'), 'inspection obligations'),
    selected: readJson(join(run, 'selected.json'), 'run selection'),
    prior: readJson(join(run, 'prior.json'), 'run prior state'),
    inventory: existsSync(join(run, 'inventory.json')) ? readJson(join(run, 'inventory.json'), 'run inventory') : null,
    reads: existsSync(join(run, 'reads.json')) ? readJson(join(run, 'reads.json'), 'pinned read receipts') : [],
    registry: readRegistry(run),
  };
}

function packetSizes(run, selected) {
  return Object.entries(selected.packets).map(([id, path]) => ({
    id,
    path: join(run, path),
    characters: readFileSync(join(run, path), 'utf8').length,
  }));
}

export function addContext({ run, concerns, governing, risk }) {
  const { selected, registry, obligations } = readRun(run);
  const requested = [
    ...new Set(
      concerns
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
    ),
  ];
  if (requested.length === 0) {
    throw new UsageError('--concerns needs at least one concern ID.');
  }
  const known = concernIds(registry);
  const knownIds = new Set(known.map(({ id }) => id));
  const unknown = requested.filter((id) => !knownIds.has(id));
  if (unknown.length > 0) {
    throw new Error(`Unknown concern ID(s): ${unknown.join(', ')}. Valid IDs: ${[...knownIds].join(', ')}.`);
  }
  const { seen } = renderAlwaysOnChecklist(registry);
  const notes = [];
  for (const id of requested) {
    if (selected.always_on.includes(id)) {
      notes.push(`${id} is always-on; it is already in context/always-on.md.`);
      continue;
    }
    const packetPath = `context/${id}.md`;
    writeFileSync(
      join(run, packetPath),
      renderConcernPacket(extractConcernContext({ ...registry, concern: id }), seen)
    );
    selected.packets[id] = packetPath;
    if (!selected.concerns.includes(id)) {
      selected.concerns.push(id);
    }
  }
  writeJson(join(run, 'selected.json'), selected);
  if (governing) {
    const additions = readJson(governing, 'reviewer-discovered governing inputs');
    if (!Array.isArray(additions)) {
      throw new Error(`Reviewer-discovered governing inputs at ${governing} must be an array.`);
    }
    const existing = new Set(obligations.map(({ id }) => id));
    for (const candidate of additions) {
      if (
        !candidate ||
        typeof candidate !== 'object' ||
        typeof candidate.id !== 'string' ||
        !FINDING_ID.test(candidate.id)
      ) {
        throw new Error('Each reviewer-discovered governing input needs an id matching the result identifier format.');
      }
      if (!GOVERNING_KINDS.includes(candidate.kind)) {
        throw new Error(`Governing input ${candidate.id} needs kind ${GOVERNING_KINDS.join(', ')}.`);
      }
      for (const field of ['source', 'reason']) {
        if (typeof candidate[field] !== 'string' || candidate[field].trim() === '') {
          throw new Error(`Governing input ${candidate.id} needs a non-empty ${field}.`);
        }
      }
      const id = `governing:${candidate.id}`;
      if (existing.has(id)) {
        throw new Error(`Governing input ${candidate.id} is already an inspection obligation.`);
      }
      obligations.push({
        id,
        obligation: 'governing_input',
        kind: candidate.kind,
        source: candidate.source,
        reason: candidate.reason,
      });
      existing.add(id);
    }
    writeJson(join(run, 'obligations.json'), obligations);
  }
  if (risk) {
    const additions = readJson(risk, 'reviewer-discovered risks');
    if (!Array.isArray(additions)) {
      throw new Error(`Reviewer-discovered risks at ${risk} must be an array.`);
    }
    const existing = new Set(obligations.map(({ id }) => id));
    for (const candidate of additions) {
      if (
        !candidate ||
        typeof candidate !== 'object' ||
        typeof candidate.id !== 'string' ||
        !FINDING_ID.test(candidate.id)
      ) {
        throw new Error('Each reviewer-discovered risk needs an id matching the result identifier format.');
      }
      for (const field of ['category', 'reason']) {
        if (typeof candidate[field] !== 'string' || candidate[field].trim() === '') {
          throw new Error(`Reviewer-discovered risk ${candidate.id} needs a non-empty ${field}.`);
        }
      }
      const id = `risk:${candidate.id}`;
      if (existing.has(id)) {
        throw new Error(`Reviewer-discovered risk ${candidate.id} is already an inspection obligation.`);
      }
      obligations.push({ id, obligation: 'risk_verification', category: candidate.category, reason: candidate.reason });
      existing.add(id);
    }
    writeJson(join(run, 'obligations.json'), obligations);
  }
  const sizes = packetSizes(run, selected);
  const total = sizes.reduce((sum, { characters }) => sum + characters, 0);
  return { selected: selected.concerns, sizes, total, notes };
}

function testFileForRead(inventory, path) {
  return (inventory?.review_files ?? inventory?.files ?? []).find(
    (file) => file.path === path && file.status !== 'D' && !file.binary && isTestPath(file.path)
  );
}

function requestedRange(value) {
  if (value === undefined) {
    return null;
  }
  const match = String(value).match(/^(\d+):(\d+)$/);
  if (!match || Number(match[1]) < 1 || Number(match[2]) < Number(match[1])) {
    throw new UsageError('--range must be START:END with positive ascending line numbers.');
  }
  return { start: Number(match[1]), end: Number(match[2]) };
}

function lineCount(text) {
  if (text === '') {
    return 0;
  }
  return text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length;
}

function pageForRanges(ranges, requested) {
  const cap = 200;
  const start = requested?.start ?? ranges[0]?.start ?? 1;
  const end = Math.min(requested?.end ?? start + cap - 1, start + cap - 1);
  const revision = ranges.find((range) => start >= range.start && start <= range.end)?.revision;
  return { start, end, revision };
}

export function readPinnedFile({ run, path, scope, range }) {
  const { manifest, inventory, reads } = readRun(run);
  const file = testFileForRead(inventory, path);
  if (!file) {
    throw new Error(`${path} is not a changed, readable test file in this run.`);
  }
  if (!TEST_SCOPES.includes(scope)) {
    throw new UsageError(`--scope must be one of ${TEST_SCOPES.join(', ')}.`);
  }
  const reviewBase = manifest.mode === 'incremental' ? manifest.incremental_from : manifest.merge_base;
  const ranges = changedLineRanges(manifest.target_repo, reviewBase, manifest.head, file);
  const headLineCount = lineCount(
    git(manifest.target_repo, ['show', `${manifest.head}:${path}`], { allowFailure: true }) ?? ''
  );
  const required = scope === 'full' ? (headLineCount === 0 ? [] : [{ start: 1, end: headLineCount }]) : ranges;
  if (required.length === 0) {
    return { content: '', receipt: { path, scope, ranges: [], bytes: 0, truncated: false }, next: null };
  }
  const page = pageForRanges(required, requestedRange(range));
  const revision = page.revision === 'base' ? reviewBase : manifest.head;
  const content = git(manifest.target_repo, ['show', `${revision}:${path}`], { allowFailure: true }) ?? '';
  const lines = content.split('\n');
  const availableEnd = Math.min(page.end, lineCount(content));
  const selectedLines = lines.slice(page.start - 1, availableEnd);
  const emittedLines = [];
  let bytes = 0;
  for (const line of selectedLines) {
    const nextBytes = Buffer.byteLength(`${line}\n`);
    if (emittedLines.length === 0 && nextBytes > MAX_READ_BYTES) {
      throw new Error(
        `${path}:${page.start} exceeds the ${MAX_READ_BYTES}-byte read cap; inspect it with a local tool and record the limitation.`
      );
    }
    if (emittedLines.length > 0 && bytes + nextBytes > MAX_READ_BYTES) {
      break;
    }
    emittedLines.push(line);
    bytes += nextBytes;
  }
  const delivered = emittedLines.join('\n');
  const actualEnd = page.start + emittedLines.length - 1;
  const truncated = actualEnd < availableEnd;
  const receipt = {
    path,
    scope,
    ranges: actualEnd >= page.start ? [{ ...page, end: actualEnd }] : [],
    bytes: Buffer.byteLength(delivered),
    truncated,
  };
  const remaining = [...reads, receipt];
  writeJson(join(run, 'reads.json'), remaining);
  const requiredEnd = Math.max(...required.map(({ end }) => end), 0);
  const next = actualEnd < requiredEnd ? `${actualEnd + 1}:${Math.min(actualEnd + 200, requiredEnd)}` : null;
  return { content: delivered, receipt, next };
}

function priorItemsById(prior) {
  return new Map(prior.items.map((item) => [item.id, item]));
}

function changedTestPaths(inventory) {
  return (inventory?.review_files ?? inventory?.files ?? [])
    .filter((file) => file.status !== 'D' && !file.binary && isTestPath(file.path))
    .map(({ path }) => path);
}

export function fullReadLines(inventory) {
  const files = inventory?.review_files ?? inventory?.files ?? [];
  const wanted = new Set(changedTestPaths(inventory));
  return files
    .filter(({ path }) => wanted.has(path))
    .map(({ added, deleted }) => added + deleted)
    .filter((lines) => lines <= LARGE_FILE_LINES)
    .reduce((sum, lines) => sum + lines, 0);
}

function coversRanges(receipts, expected) {
  return expected.every((required) => {
    let cursor = required.start;
    const ranges = receipts
      .flatMap((receipt) => receipt.ranges ?? [])
      .filter((range) => range.revision === required.revision)
      .sort((left, right) => left.start - right.start || left.end - right.end);
    for (const range of ranges) {
      if (range.end < cursor || range.start > cursor) {
        continue;
      }
      cursor = Math.max(cursor, range.end + 1);
      if (cursor > required.end) {
        return true;
      }
    }
    return cursor > required.end;
  });
}

function validateTestReview(errors, result, inventory, reads = [], manifest = {}) {
  const required = changedTestPaths(inventory);
  const overBudget = fullReadLines(inventory) > TEST_LINE_BUDGET;
  if (required.length === 0 && result.tests === undefined) {
    return;
  }
  const entries = requireArray(errors, result.tests ?? [], 'tests');
  const seen = new Set();
  entries.forEach((entry, index) => {
    const label = `tests[${index}]`;
    if (!required.includes(entry?.path)) {
      errors.push(`${label}.path ${JSON.stringify(entry?.path)} is not a changed test file in this run`);
      return;
    }
    if (seen.has(entry.path)) {
      errors.push(`tests lists ${entry.path} more than once`);
    }
    seen.add(entry.path);
    if (entry.read === true) {
      const file = (inventory?.review_files ?? inventory?.files ?? []).find(({ path }) => path === entry.path);
      const large = (file !== undefined && file.added + file.deleted > LARGE_FILE_LINES) || overBudget;
      if (!TEST_SCOPES.includes(entry.scope)) {
        errors.push(`${label}.scope must be one of ${TEST_SCOPES.join(', ')} when read is true`);
      } else if (entry.scope === 'changed_hunks' && !large) {
        errors.push(
          `${label}.scope changed_hunks is only allowed for a test file with more than ${LARGE_FILE_LINES} changed lines, or when the test files you would read in full total more than ${TEST_LINE_BUDGET} changed lines; read ${entry.path} in full`
        );
      }
      if (entry.scope === 'changed_hunks') {
        const receipts = reads.filter(
          (candidate) => candidate.path === entry.path && candidate.scope === 'changed_hunks'
        );
        const reviewBase = manifest.mode === 'incremental' ? manifest.incremental_from : manifest.merge_base;
        const expectedRanges = file ? changedLineRanges(manifest.target_repo, reviewBase, manifest.head, file) : [];
        if (receipts.length === 0 || !coversRanges(receipts, expectedRanges)) {
          errors.push(
            `${label} needs pinned read receipts covering every changed head range; run review-lite.mjs read with --scope changed_hunks until next is empty`
          );
        }
      } else {
        const content =
          git(manifest.target_repo, ['show', `${manifest.head}:${entry.path}`], { allowFailure: true }) ?? '';
        const lineCount =
          content === '' ? 0 : content.endsWith('\n') ? content.split('\n').length - 1 : content.split('\n').length;
        const receipts = reads.filter((receipt) => receipt.path === entry.path && receipt.scope === 'full');
        if (!coversRanges(receipts, lineCount === 0 ? [] : [{ start: 1, end: lineCount }])) {
          errors.push(
            `${label} needs pinned full-read receipts; run review-lite.mjs read with --scope full until next is empty`
          );
        }
      }
      requireString(
        errors,
        entry.assertions_checked,
        `${label}.assertions_checked (which new assertions would fail if the behavior regressed, and which would not)`
      );
    } else if (entry.read === false) {
      if (!UNREAD_KINDS.includes(entry.reason_kind)) {
        errors.push(
          `${label}.reason_kind must be one of ${UNREAD_KINDS.join(', ')} when read is false; effort, time, and size are not reasons, use scope changed_hunks for a large file`
        );
      }
      requireString(errors, entry.reason, `${label}.reason (why this test file was not read in full)`);
      if (typeof entry.reason === 'string' && EFFORT_REASON.test(entry.reason)) {
        errors.push(
          `${label}.reason cites effort, time, or size; read the file, or use scope changed_hunks when it is large`
        );
      }
    } else {
      errors.push(`${label}.read must be a boolean`);
    }
  });
  if (result.assessment === 'complete') {
    const missing = required.filter((path) => !seen.has(path));
    if (missing.length > 0) {
      errors.push(
        `a complete assessment needs a tests entry for every changed test file; read each in full or record why not: ${missing.join(', ')}`
      );
    }
  }
}

function hasRelativeRunArtifact(run, artifact) {
  if (
    typeof artifact !== 'string' ||
    artifact === '' ||
    artifact.startsWith('/') ||
    artifact.split('/').includes('..') ||
    !existsSync(join(run, artifact))
  ) {
    return false;
  }
  return statSync(join(run, artifact)).isFile();
}

function hasResolvableGoverningSource(manifest, source, pin) {
  const local = String(source).match(/^(head|base):(.+)$/);
  if (local) {
    const revision = local[1] === 'head' ? manifest.head : manifest.merge_base;
    return (
      pin === revision &&
      git(manifest.target_repo, ['cat-file', '-e', `${revision}:${local[2]}`], { allowFailure: true }) !== null
    );
  }
  try {
    const url = new URL(String(source));
    const segments = [...url.pathname.split('/'), ...url.searchParams.values()];
    return url.protocol === 'https:' && REVISION_PIN.test(String(pin)) && segments.includes(String(pin));
  } catch {
    return false;
  }
}

export function validateResult(
  result,
  { selected, prior, registry, inventory, obligations = [], reads = [], manifest = {}, run }
) {
  const errors = [];
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return ['result must be an object'];
  }
  const knownConcerns = new Set(concernIds(registry).map(({ id }) => id));
  const selectedConcerns = new Set(selected.concerns);
  if (result.assessment !== 'complete' && result.assessment !== 'incomplete') {
    errors.push('assessment must be complete or incomplete');
  }
  requireArray(errors, result.limitations, 'limitations').forEach((value, index) =>
    requireString(errors, value, `limitations[${index}]`)
  );

  const covered = new Map();
  requireArray(errors, result.coverage, 'coverage').forEach((entry, index) => {
    const label = `coverage[${index}]`;
    if (!knownConcerns.has(entry?.concern_id)) {
      errors.push(`${label}.concern_id ${JSON.stringify(entry?.concern_id)} is not a known concern`);
      return;
    }
    if (!selectedConcerns.has(entry.concern_id)) {
      errors.push(
        `${label} claims ${entry.concern_id}, which was never selected; load it with the context command first`
      );
    }
    if (covered.has(entry.concern_id)) {
      errors.push(`coverage lists ${entry.concern_id} more than once`);
    }
    covered.set(entry.concern_id, entry.status);
    if (!['checked', 'not_applicable', 'unresolved'].includes(entry.status)) {
      errors.push(`${label}.status must be checked, not_applicable, or unresolved`);
    }
    if (requireString(errors, entry.evidence, `${label}.evidence`) && entry.status === 'not_applicable') {
      if (PLACEHOLDER_REASONS.has(entry.evidence.trim().toLowerCase().replace(/\.$/, ''))) {
        errors.push(`${label} is not_applicable without a concrete reason`);
      }
    }
  });

  const priorItems = priorItemsById(prior);
  const decisions = new Map();
  requireArray(errors, result.prior_decisions, 'prior_decisions').forEach((decision, index) => {
    const label = `prior_decisions[${index}]`;
    if (!priorItems.has(decision?.id)) {
      errors.push(
        `${label}.id ${JSON.stringify(decision?.id)} is not an item in the trusted prior state${prior.status === 'untrusted' ? ' (the supplied prior state was rejected)' : ''}`
      );
      return;
    }
    if (decisions.has(decision.id)) {
      errors.push(`prior_decisions lists ${decision.id} more than once`);
    }
    decisions.set(decision.id, decision.action);
    if (!['carry', 'resolved', 'reopen'].includes(decision.action)) {
      errors.push(`${label}.action must be carry, resolved, or reopen`);
    }
    requireString(errors, decision.evidence, `${label}.evidence`);
  });

  const currentIds = new Set();
  const findings = requireArray(errors, result.findings, 'findings');
  findings.forEach((finding, index) => {
    const label = `findings[${index}]`;
    validateFindingRecord(errors, finding, label, knownConcerns, { strict: true, round: manifest.round });
    if (knownConcerns.has(finding?.concern_id) && !selectedConcerns.has(finding.concern_id)) {
      errors.push(
        `${label}.concern_id ${finding.concern_id} was never selected; load it with the context command first`
      );
    }
    if (currentIds.has(finding?.id)) {
      errors.push(`finding id ${finding.id} is used more than once`);
    }
    currentIds.add(finding?.id);
    if (priorItems.has(finding?.id) && decisions.get(finding.id) !== 'reopen') {
      errors.push(`${label}.id ${finding.id} belongs to a prior item; reuse it only with a reopen decision`);
    }
  });
  const optionalCount = findings.filter((finding) => ['nit', 'suggestion'].includes(finding?.disposition)).length;
  if (optionalCount > MAX_NITS) {
    errors.push(
      `at most ${MAX_NITS} optional suggestions are allowed; got ${optionalCount}. Keep the ones a maintainer would act on.`
    );
  }
  requireArray(errors, result.clearances, 'clearances').forEach((clearance, index) => {
    const label = `clearances[${index}]`;
    validateClearanceRecord(errors, clearance, label, knownConcerns);
    if (knownConcerns.has(clearance?.concern_id) && !selectedConcerns.has(clearance.concern_id)) {
      errors.push(
        `${label}.concern_id ${clearance.concern_id} was never selected; load it with the context command first`
      );
    }
    if (currentIds.has(clearance?.id) || priorItems.has(clearance?.id)) {
      errors.push(`${label}.id ${clearance?.id} collides with another finding, clearance, or prior item`);
    }
    currentIds.add(clearance?.id);
  });
  for (const [id, action] of decisions) {
    if (action === 'reopen' && !findings.some((finding) => finding?.id === id)) {
      errors.push(`prior item ${id} is reopened, so findings must restate it with the same id and the new evidence`);
    }
  }
  const expected = new Map(obligations.map((entry) => [entry.id, entry]));
  const checked = new Set();
  requireArray(errors, result.checks ?? [], 'checks').forEach((check, index) => {
    const obligation = expected.get(check?.id);
    if (!obligation || checked.has(check.id)) {
      errors.push(`checks[${index}] has an unknown or duplicate obligation id`);
      return;
    }
    checked.add(check.id);
    if (!['checked', 'irrelevant', 'unresolved'].includes(check.status)) {
      errors.push(`checks[${index}].status must be checked, irrelevant, or unresolved`);
    }
    if (
      requireString(errors, check.evidence, `checks[${index}].evidence`) &&
      PLACEHOLDER_REASONS.has(check.evidence.trim().toLowerCase().replace(/\.$/, ''))
    ) {
      errors.push(`checks[${index}] needs concrete evidence`);
    }
    if (
      obligation.concern_id &&
      !selectedConcerns.has(obligation.concern_id) &&
      !['irrelevant', 'unresolved'].includes(check.status)
    ) {
      errors.push(`unselected concern ${obligation.concern_id} needs a dismissal reason`);
    }
    if (obligation.obligation === 'governing_input') {
      if (check.status === 'checked') {
        if (!GOVERNING_KINDS.includes(check.governing?.kind)) {
          errors.push(`checks[${index}].governing.kind must be one of ${GOVERNING_KINDS.join(', ')}`);
        }
        for (const field of ['source', 'pin', 'applicability']) {
          requireString(errors, check.governing?.[field], `checks[${index}].governing.${field}`);
        }
        if (!hasResolvableGoverningSource(manifest, check.governing?.source, check.governing?.pin)) {
          errors.push(
            `checks[${index}].governing source and pin must resolve as head:path/base:path at its pinned revision, or be an immutable https reference`
          );
        }
      }
      if (result.assessment === 'complete' && check.status === 'unresolved') {
        errors.push(`a complete assessment cannot leave governing input ${check.id} unavailable`);
      }
    }
    if (obligation.obligation === 'risk_verification') {
      if (check.status === 'checked') {
        for (const field of ['invariant', 'falsifying_scenario', 'expected', 'observed', 'artifact']) {
          requireString(errors, check.verification?.[field], `checks[${index}].verification.${field}`);
        }
        if (!RISK_METHODS.includes(check.verification?.method)) {
          errors.push(`checks[${index}].verification.method must be one of ${RISK_METHODS.join(', ')}`);
        }
        if (!hasRelativeRunArtifact(run, check.verification?.artifact)) {
          errors.push(
            `checks[${index}].verification.artifact must name an existing relative artifact in the run directory`
          );
        }
      }
      if (result.assessment === 'complete' && check.status === 'unresolved') {
        errors.push(`a complete assessment cannot leave risk ${check.id} unresolved`);
      }
    }
    if (result.assessment === 'complete' && check.status === 'unresolved') {
      errors.push(`a complete assessment cannot leave ${check.id} unresolved`);
    }
  });
  if (result.assessment === 'complete') {
    for (const entry of obligations) {
      if (!checked.has(entry.id) && !selectedConcerns.has(entry.concern_id)) {
        errors.push(`missing inspection decision: ${entry.id}`);
      }
    }
  }
  validateTestReview(errors, result, inventory, reads, manifest);

  if (result.assessment === 'complete') {
    const uncovered = selected.concerns.filter((id) => !covered.has(id));
    if (uncovered.length > 0) {
      errors.push(`a complete assessment needs coverage for every selected concern; missing: ${uncovered.join(', ')}`);
    }
    const unresolved = [...covered].filter(([, status]) => status === 'unresolved').map(([id]) => id);
    if (unresolved.length > 0) {
      errors.push(`a complete assessment cannot leave coverage unresolved: ${unresolved.join(', ')}`);
    }
    const undecided = [...priorItems.keys()].filter((id) => !decisions.has(id));
    if (undecided.length > 0) {
      errors.push(`a complete assessment needs a prior decision for: ${undecided.join(', ')}`);
    }
  }
  return errors;
}

function pick(record, fields) {
  return Object.fromEntries(
    fields.filter((field) => record[field] !== undefined).map((field) => [field, record[field]])
  );
}

const STATE_FINDING_FIELDS = [
  'id',
  'concern_id',
  'disposition',
  'title',
  'location',
  'evidence',
  'consequence',
  'base_comparison',
  'required_invariant',
  'merge_reason',
  'next_action',
  'attribution',
  'deferral_basis',
  'deferral_reason',
  'scope_decision',
  'why_not_blocker',
  'recorded_at_head',
];
const STATE_CLEARANCE_FIELDS = ['id', 'concern_id', 'claim', 'evidence', 'recorded_at_head'];

export function deriveState(result, { manifest, prior }) {
  const decisions = new Map(result.prior_decisions.map(({ id, action }) => [id, action]));
  const carried = prior.items.filter((item) => decisions.get(item.id) === 'carry');
  const findings = [
    ...carried.filter(({ kind }) => kind === 'finding').map((item) => pick(item, STATE_FINDING_FIELDS)),
    ...result.findings
      .filter(({ disposition }) => ['blocker', 'separate_work'].includes(disposition))
      .map((finding) => pick({ ...finding, recorded_at_head: manifest.head }, STATE_FINDING_FIELDS)),
  ];
  const clearances = [
    ...carried.filter(({ kind }) => kind === 'clearance').map((item) => pick(item, STATE_CLEARANCE_FIELDS)),
    ...result.clearances.map((clearance) =>
      pick({ ...clearance, recorded_at_head: manifest.head }, STATE_CLEARANCE_FIELDS)
    ),
  ];
  return {
    version: STATE_VERSION,
    review_key: manifest.review_key,
    round: manifest.round,
    reviewed_head: manifest.head,
    base: manifest.base,
    merge_base: manifest.merge_base,
    registry: pick(manifest.registry, ['concerns_sha256', 'details_sha256']),
    findings,
    clearances,
  };
}

function short(sha) {
  return sha.slice(0, 12);
}

function findingBlock(finding, { carried = false } = {}) {
  const lines = [`### ${finding.id}: ${finding.title}${carried ? ' (carried from a prior round)' : ''}`, ''];
  lines.push(
    `- Concern: \`${finding.concern_id}\``,
    `- Location: ${finding.location}`,
    `- Evidence: ${finding.evidence}`
  );
  lines.push(`- Consequence: ${finding.consequence}`, `- Base comparison: ${finding.base_comparison}`);
  if (finding.disposition === 'blocker') {
    lines.push(`- Required invariant: ${finding.required_invariant}`, `- Why it blocks: ${finding.merge_reason}`);
  } else if (finding.disposition === 'separate_work' || finding.disposition === 'follow_up') {
    lines.push(`- Maintainer next action: ${finding.next_action}`);
    lines.push(
      `- Deferral: ${
        finding.disposition === 'follow_up'
          ? `Legacy follow-up retained without a new deferral basis${finding.why_not_blocker ? `; ${finding.why_not_blocker}` : ''}`
          : `${finding.deferral_basis}: ${finding.deferral_reason}`
      }`
    );
  } else {
    lines.push(`- Suggested change: ${finding.next_action}`);
  }
  return lines.join('\n');
}

function nitLine(nit) {
  return `${nit.id} (\`${nit.concern_id}\`, ${nit.location}): ${nit.title}. Evidence: ${nit.evidence} Suggested: ${nit.next_action}`;
}

export function renderReport(result, { manifest, prior }) {
  const decisions = new Map(result.prior_decisions.map((decision) => [decision.id, decision]));
  const carried = prior.items.filter((item) => item.kind === 'finding' && decisions.get(item.id)?.action === 'carry');
  const blockers = [
    ...result.findings.filter(({ disposition }) => disposition === 'blocker').map((finding) => ({ finding })),
    ...carried.filter(({ disposition }) => disposition === 'blocker').map((finding) => ({ finding, carried: true })),
  ];
  const headline =
    result.assessment === 'incomplete' ? 'Review incomplete' : blockers.length > 0 ? 'Changes requested' : 'Approve';

  const scope = [
    ...(manifest.round === undefined ? [] : [`- Round: ${manifest.round}`]),
    `- Review: ${manifest.review_key}, ${manifest.mode} review of ${short(manifest.merge_base)}..${short(manifest.head)} (${manifest.files_changed} files)${manifest.mode === 'incremental' ? `, increment since ${short(manifest.incremental_from)}` : ''}`,
  ];
  if (manifest.fallback_reason) {
    scope.push(`- Full review because ${manifest.fallback_reason}.`);
  }
  const byStatus = (status) => result.coverage.filter((entry) => entry.status === status);
  const checked = byStatus('checked').map(({ concern_id }) => `\`${concern_id}\``);
  if (checked.length > 0) {
    scope.push(`- Checked: ${checked.join(', ')}`);
  }
  for (const entry of byStatus('not_applicable')) {
    scope.push(`- Not applicable: \`${entry.concern_id}\`: ${entry.evidence}`);
  }
  for (const entry of byStatus('unresolved')) {
    scope.push(`- Unresolved: \`${entry.concern_id}\`: ${entry.evidence}`);
  }
  const tests = result.tests ?? [];
  if (tests.length > 0) {
    const readTests = tests.filter(({ read }) => read);
    const hunks = readTests.filter(({ scope: readScope }) => readScope === 'changed_hunks').length;
    scope.push(
      `- Test files read: ${readTests.length} of ${tests.length}${hunks > 0 ? ` (${hunks} by changed hunks, large files)` : ''}`
    );
    for (const entry of tests.filter(({ read }) => !read)) {
      scope.push(`- Limitation: test file ${entry.path} was not read in full: ${entry.reason}`);
    }
  }
  for (const check of (result.checks ?? []).filter(({ status }) => status === 'unresolved')) {
    scope.push(`- Unresolved inspection: ${check.id}: ${check.evidence}`);
  }
  for (const limitation of result.limitations) {
    scope.push(`- Limitation: ${limitation}`);
  }

  const sections = [`## ${headline}`, scope.join('\n')];
  if (blockers.length > 0) {
    sections.push('## Blocking findings', ...blockers.map((entry) => findingBlock(entry.finding, entry)));
  }
  const suggestions = result.findings.filter(({ disposition }) => ['suggestion', 'nit'].includes(disposition));
  if (suggestions.length > 0) {
    sections.push(
      '## Optional suggestions',
      'These are optional and do not change the merge decision.',
      bulletList(suggestions.map(nitLine))
    );
  }
  const resolved = result.prior_decisions.filter(({ action }) => action === 'resolved');
  if (resolved.length > 0) {
    sections.push(
      '## Resolved since the prior review',
      bulletList(resolved.map(({ id, evidence }) => `${id}: ${evidence}`))
    );
  }
  const reopened = result.prior_decisions.filter(({ action }) => action === 'reopen');
  if (reopened.length > 0) {
    sections.push('## Reopened', bulletList(reopened.map(({ id, evidence }) => `${id}: ${evidence}`)));
  }
  const clearances = [
    ...result.clearances.map((entry) => ({ entry, carried: false })),
    ...prior.items
      .filter((item) => item.kind === 'clearance' && decisions.get(item.id)?.action === 'carry')
      .map((entry) => ({ entry, carried: true })),
  ];
  if (clearances.length > 0) {
    sections.push(
      '## Explicit clearances',
      bulletList(
        clearances.map(
          ({ entry, carried }) =>
            `${entry.id} (\`${entry.concern_id}\`${carried ? ', carried' : ''}): ${entry.claim} Evidence: ${entry.evidence}`
        )
      )
    );
  }
  return `${sections.join('\n\n')}\n`;
}

export function renderMaintainerQueue(result, { manifest, prior }) {
  const decisions = new Map(result.prior_decisions.map((decision) => [decision.id, decision]));
  const carried = prior.items.filter((item) => item.kind === 'finding' && decisions.get(item.id)?.action === 'carry');
  const separateWork = [
    ...result.findings.filter(({ disposition }) => disposition === 'separate_work').map((finding) => ({ finding })),
    ...carried
      .filter(({ disposition }) => ['separate_work', 'follow_up'].includes(disposition))
      .map((finding) => ({ finding, carried: true })),
  ];
  if (separateWork.length === 0) {
    return null;
  }
  return `# Maintainer queue\n\nReview: ${manifest.review_key}, round ${manifest.round}\n\nThese are maintainer-owned items outside the author approval report. None is filed automatically.\n\n${separateWork.map((entry) => findingBlock(entry.finding, entry)).join('\n\n')}\n`;
}

export function finish({ run, input }) {
  const context = readRun(run);
  ['report.md', 'maintainer-queue.md', 'state.json'].forEach((name) => rmSync(join(run, name), { force: true }));
  const result = readJson(input, 'result');
  const errors = validateResult(result, { ...context, run });
  if (errors.length > 0) {
    throw new Error(`Result is invalid; no report or state was written:\n- ${errors.join('\n- ')}`);
  }
  const report = renderReport(result, context);
  writeFileSync(join(run, 'report.md'), report);
  const maintainerQueue = renderMaintainerQueue(result, context);
  if (maintainerQueue) {
    writeFileSync(join(run, 'maintainer-queue.md'), maintainerQueue);
  }
  if (resolve(input) !== resolve(join(run, 'result.json'))) {
    writeJson(join(run, 'result.json'), result);
  }
  let state = null;
  if (result.assessment === 'complete') {
    state = deriveState(result, context);
    writeJson(join(run, 'state.json'), state);
  } else {
    rmSync(join(run, 'state.json'), { force: true });
  }
  return { report, state, maintainerQueue, headline: report.split('\n')[0].replace(/^## /, '') };
}

function formatCharacters(value) {
  return value.toLocaleString('en-US');
}

function contextSummary({ selected, sizes, total, notes }) {
  const lines = [...notes, `Selected concerns: ${selected.join(', ')}`];
  for (const { path, characters } of sizes) {
    lines.push(`  ${path}  ${formatCharacters(characters)} chars`);
  }
  lines.push(
    `Selected concern content: ${formatCharacters(total)} chars (soft budget ${formatCharacters(INITIAL_CONTEXT_BUDGET)}).`
  );
  if (total > INITIAL_CONTEXT_BUDGET) {
    lines.push(
      `Over the soft budget by ${formatCharacters(total - INITIAL_CONTEXT_BUDGET)} chars. Nothing was truncated; load further packets only when evidence calls for them.`
    );
  }
  return lines.join('\n');
}

export function main(argv) {
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === '-h') {
    return { output: topHelp(), code: command ? 0 : 2 };
  }
  if (rest.includes('--help') || rest.includes('-h')) {
    if (!HELP[command]) {
      throw new UsageError(`Unknown command ${JSON.stringify(command)}.\n\n${topHelp()}`);
    }
    return { output: HELP[command], code: 0 };
  }
  const options = parseArgs(command, rest);
  if (command === 'prepare') {
    const { manifest, routing, files, sync, delta, checklistCharacters } = prepare(options);
    const lines = [
      `Prepared ${manifest.mode} review of ${short(manifest.merge_base)}..${short(manifest.head)} (${files.length} files) in ${options.out}`,
    ];
    if (manifest.fallback_reason) {
      lines.push(`Full review because ${manifest.fallback_reason}.`);
    }
    lines.push(
      `Always-on checklist: ${join(options.out, 'context', 'always-on.md')} (${formatCharacters(checklistCharacters)} chars)`,
      `Candidates (${routing.candidates.length}): ${routing.candidates.map(({ id, lexical_evidence }) => `${id} [${lexical_evidence}]`).join(', ') || 'none'}`,
      `Sync nominations: ${sync.hits.length} hits, ${sync.doc_gaps.length} doc gaps (${join(options.out, 'sync-hits.json')}); delta triggers: ${delta.triggers.length} (${join(options.out, 'delta-triggers.json')})`,
      `Unrouted files: ${routing.unrouted_files.length}; targeted inspection: ${files.filter((file) => file.targeted_inspection.length > 0).length}`,
      `Inventory: ${join(options.out, 'inventory.json')}; patch: ${join(options.out, 'changes.patch')}${manifest.artifacts.incremental_patch ? `; increment: ${join(options.out, 'incremental.patch')}` : ''}`
    );
    return { output: lines.join('\n'), code: 0 };
  }
  if (command === 'context') {
    return { output: contextSummary(addContext(options)), code: 0 };
  }
  if (command === 'read') {
    const { content, receipt, next } = readPinnedFile(options);
    return {
      output: `${content}\n\n[review-lite read: ${receipt.path} ${receipt.scope} ${receipt.ranges
        .map(({ start, end, revision }) => `${revision === 'base' ? 'base:' : ''}${start}-${end}`)
        .join(
          ', '
        )}; ${receipt.bytes} bytes emitted; helper cannot attest downstream display truncation${next ? `; next range: ${next}` : ''}]`,
      code: 0,
    };
  }
  const { headline, state, maintainerQueue } = finish(options);
  return {
    output: `${headline}. Report: ${join(options.run, 'report.md')}${maintainerQueue ? `; maintainer queue: ${join(options.run, 'maintainer-queue.md')}` : ''}${state ? `; state: ${join(options.run, 'state.json')}` : '; no state written (incomplete)'}`,
    code: 0,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const { output, code } = main(process.argv.slice(2));
    (code === 0 ? process.stdout : process.stderr).write(`${output}\n`);
    process.exitCode = code;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = error instanceof UsageError ? 2 : 1;
  }
}
