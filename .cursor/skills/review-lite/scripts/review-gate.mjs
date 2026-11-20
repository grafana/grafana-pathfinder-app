import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HELPER = fileURLToPath(new URL('../../community-pr/scripts/community_pr_gate.py', import.meta.url));

export function assertReviewGate(
  options,
  snapshot = (number, repo) =>
    JSON.parse(
      execFileSync('python3', [HELPER, 'snapshot', number, '--repo-dir', repo], {
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
      })
    )
) {
  const match = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#([1-9][0-9]*)$/.exec(options['review-key'] ?? '');
  if (!match) {
    throw new Error('Review preparation requires an owner/repository#number review key.');
  }
  const gate = snapshot(match[2], options.repo);
  if (
    gate.repository !== match[1] ||
    gate.pr_number !== Number(match[2]) ||
    gate.head_sha !== options.head ||
    gate.base_sha !== options.base
  ) {
    throw new Error(
      'Gate source does not match the requested repository, PR, base and head. Restart from a fresh snapshot.'
    );
  }
  if (gate.scanner?.status !== 'passed' || !['internal', 'ready_for_triage'].includes(gate.status)) {
    throw new Error(`Community gate stopped review preparation: ${gate.status}. Resolve the gate before reviewing.`);
  }
  if (gate.status === 'internal' && gate.internal_basis !== 'write_access') {
    throw new Error('Only verified repository write access establishes an inner contributor.');
  }
  return gate;
}
