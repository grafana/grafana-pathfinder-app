#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import { parseArgs as parseCliArgs } from 'node:util';

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SCRATCH_PATTERN = /^\/[A-Za-z0-9_./-]+$/;

export function parseArgs(argv) {
  try {
    return parseCliArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: { repo: { type: 'string' }, pr: { type: 'string' }, scratch: { type: 'string' } },
    }).values;
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}. Expected --repo, --pr, and --scratch.`);
  }
}

export function buildDispatchBrief({ repo, pr, scratch }) {
  if (!REPO_PATTERN.test(repo ?? '')) {
    throw new Error('repo must look like owner/name');
  }
  if (!/^[1-9]\d{0,7}$/.test(pr ?? '')) {
    throw new Error('pr must be a positive integer');
  }
  if (!SCRATCH_PATTERN.test(scratch ?? '') || scratch.includes('..')) {
    throw new Error('scratch must be an absolute path of letters, digits, dots, dashes, underscores, and slashes');
  }
  const dir = `${scratch.replace(/\/$/, '')}/pr-${pr}`;
  const prefix = `pr${pr}-`;
  const scripts = '.cursor/skills/review/scripts';
  return [
    `Run the COMPLETE /review pipeline for https://github.com/${repo}/pull/${pr} (PR ${pr}). Do NOT publish anything to GitHub. Stop after rendering. Do not state a merge opinion; review-policy.mjs and review-report.mjs decide.`,
    '',
    'HARD RULE: you may not skip, shrink, or substitute any stage, and you may not decide a stage does not apply when a script decides it. If a stage cannot run (missing tool, no Agent tool, script error you cannot fix), STOP and return a report naming the blocked stage and why. Skipping a stage is allowed only with a quoted instruction from the user, recorded in the ledger as user_consent. Rendering with a degraded stage is not allowed; render an incomplete assessment instead.',
    '',
    'SETUP, in order:',
    '1. `pwd`; `git rev-parse --abbrev-ref HEAD`. Work only in your isolated worktree by absolute path.',
    `2. Fetch the PR as a named ref (a combined fetch leaves FETCH_HEAD on main): \`git fetch origin main\`, then \`git fetch origin refs/pull/${pr}/head:refs/remotes/origin/pr-${pr}\`, then \`git reset --hard origin/pr-${pr}\`.`,
    `3. Verify \`git rev-parse HEAD\` equals \`gh pr view ${pr} --repo ${repo} --json headRefOid -q .headRefOid\`. Record head SHA and base SHA (merge-base with origin/main).`,
    '4. Symlink node_modules from the main checkout into the worktree; without it typecheck reports about 113,000 phantom errors.',
    `5. Scratch files go ONLY in \`${dir}/\`, every file prefixed \`${prefix}\`. Sibling agents share the scratchpad. Before rendering, assert the report's PR number and head SHA are yours.`,
    '',
    'PIPELINE: read `.cursor/skills/review/SKILL.md` in full and follow it exactly, including its completeness contract.',
    `- Run \`node ${scripts}/security-gate.mjs --base <base-sha> --head <head-sha>\`. If it triggers, the security specialist is mandatory (use the secure skill) and takes a plan slot. Record both values in the ledger.`,
    '- Use the planner worker count as a ceiling for bundling, never as permission to run fewer observation passes than the routed concerns need. Every planned worker must run as a real subagent.',
    '- Send every observation through review-policy.mjs, including low ones, and run exactly the skeptic roles it returns.',
    '',
    'EVIDENCE CHECKS (all required for changed behavior):',
    '- Run focused tests with `--coverage=false`, `npm run typecheck`, and eslint on touched files, at the PR head.',
    `- Test efficacy: create a second disposable worktree (\`git worktree add ${dir}/${prefix}mut <head-sha> --detach\`, symlink node_modules), revert only the production change there, run the focused test, record whether it fails, then remove that worktree. Never mutate your review worktree.`,
    '- For each probe a worker claims, execute it; reading code is not a probe.',
    '',
    'SUBAGENT RULES for every agent you spawn: forbid git checkout, switch, stash, restore, reset and any write in the review worktree. Read via `git show <sha>:<path>` and `git diff <base>...<head>`. Give each agent its own file prefix. Before each policy or report script and each test run, check `git rev-parse HEAD` equals the PR head, and check `git reflog` before trusting worker evidence.',
    '',
    'RETURN:',
    '1. The stage_ledger JSON you passed to review-report.mjs (schema: `node .cursor/skills/review/scripts/concern-context.mjs --section "Stage ledger"`), with evidence for every field.',
    '2. The renderer output verbatim, read from the output file; do not retype or escape it.',
    '3. Head SHA, mode, round.',
    '4. Any impact or breaks_shipped_path field changed after the policy blocked it, with skeptic evidence.',
    '5. A candid list of what you could not verify.',
  ].join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  process.stdout.write(`${buildDispatchBrief(args)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
