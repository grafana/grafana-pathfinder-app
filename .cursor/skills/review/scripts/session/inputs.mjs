import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { extractConcernContext, workerConcernContext } from '../concern-context.mjs';
import { computeGate } from '../contract-evolution-gate.mjs';
import { findTable, unquote } from '../registry-table.mjs';
import { extractSections } from '../review-section.mjs';
import { computeSecurityGate } from '../security-gate.mjs';
import { sha256 } from './model.mjs';

export const TOOL_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));

export const SHARED_INPUTS = [
  'docs/design/CONCERNS.md',
  'docs/design/CONCERN_DETAILS.md',
  'docs/design/PR_REVIEW.md',
  '.cursor/skills/review/SKILL.md',
  '.cursor/skills/review/scripts/adversarial-policy.mjs',
  '.cursor/skills/review/scripts/concern-context.mjs',
  '.cursor/skills/review/scripts/contract-evolution-gate.mjs',
  '.cursor/skills/review/scripts/contract-evolution-policy.mjs',
  '.cursor/skills/review/scripts/review-ledger.mjs',
  '.cursor/skills/review/scripts/review-policy.mjs',
  '.cursor/skills/review/scripts/review-report.mjs',
  '.cursor/skills/review/scripts/security-gate.mjs',
];

function toolFile(path) {
  return readFileSync(`${TOOL_ROOT}${path}`, 'utf8');
}

export function sharedInputHashes() {
  return Object.fromEntries(SHARED_INPUTS.map((path) => [path, sha256(toolFile(path))]));
}

export function assertSharedInputsUnchanged(identity) {
  const current = sharedInputHashes();
  const changed = SHARED_INPUTS.filter((path) => identity.shared_inputs[path] !== current[path]);
  if (changed.length > 0) {
    throw new Error(
      `shared review inputs changed since this session started (${changed.join(', ')}). Start a new session; a session never mixes policy versions`
    );
  }
}

export function toolRevision() {
  const run = (args) => spawnSync('git', args, { cwd: TOOL_ROOT, encoding: 'utf8' });
  const head = run(['rev-parse', 'HEAD']);
  const dirty = run(['status', '--porcelain', '--', '.cursor/skills/review', 'docs/design']);
  return {
    commit: head.status === 0 ? head.stdout.trim() : null,
    review_assets_dirty: dirty.status === 0 ? dirty.stdout.trim().length > 0 : null,
  };
}

export function loadRegistry() {
  const routingMarkdown = toolFile('docs/design/CONCERNS.md');
  const detailMarkdown = toolFile('docs/design/CONCERN_DETAILS.md');
  const rows = findTable(routingMarkdown, ['id', 'trigger_paths', 'trigger_keywords']);
  const concerns = rows.map((row) => {
    const context = extractConcernContext({ routingMarkdown, detailMarkdown, concern: unquote(row.id) });
    return { id: context.id, category: context.category, has_anchor: context.contract_anchor !== null, context };
  });
  return {
    ids: concerns.map(({ id }) => id),
    always_on: concerns.filter(({ category }) => category === 'always-on').map(({ id }) => id),
    category: (id) => concerns.find((concern) => concern.id === id)?.category,
    hasAnchor: (id) => concerns.find((concern) => concern.id === id)?.has_anchor === true,
    workerPacket: (id) => workerConcernContext(concerns.find((concern) => concern.id === id).context),
  };
}

export function reviewSection(...headings) {
  return extractSections(toolFile('docs/design/PR_REVIEW.md'), headings);
}

function git(repoDir, args) {
  return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
    cwd: repoDir,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

export function realEffects(repoDir) {
  return {
    changedFiles(from, to) {
      return git(repoDir, ['diff', '--no-renames', '--name-only', `${from}...${to}`])
        .split('\n')
        .filter(Boolean);
    },
    diff(from, to, paths) {
      return git(repoDir, ['diff', '--no-color', '--no-ext-diff', '--no-renames', `${from}...${to}`, '--', ...paths]);
    },
    securityGate(from, to) {
      return computeSecurityGate({ base: from, head: to, cwd: repoDir });
    },
    contractGate(base, head, concern) {
      try {
        return { status: 'ran', result: computeGate({ base, head, concern, cwd: repoDir }) };
      } catch (error) {
        if (/no concrete trigger paths|not present in the routing table/.test(error.message)) {
          return { status: 'not_applicable', reason: error.message };
        }
        throw error;
      }
    },
    isAncestor(ancestor, descendant) {
      return spawnSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd: repoDir }).status === 0;
    },
    commitExists(sha) {
      return spawnSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: repoDir }).status === 0;
    },
  };
}
