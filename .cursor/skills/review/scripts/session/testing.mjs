import { advance, buildIdentity, recordBlocked, recordResult, recordWaiver } from './controller.mjs';
import { applyEvent, emptyState, sealEvents } from './model.mjs';

export const HEAD = 'b'.repeat(40);
export const BASE = 'a'.repeat(40);
export const PRIOR_HEAD = 'c'.repeat(40);
export const ALWAYS_ON = [
  'security',
  'correctness-and-reliability',
  'testing-and-verification',
  'reversibility-and-one-way-door',
  'cross-cutting-architecture',
];
const CATEGORIES = {
  'context-engine': 'subsystem',
  'interactive-engine': 'subsystem',
  'docs-retrieval-and-rendering': 'subsystem',
};

const FIXED_TIME = () => '2026-10-06T00:00:00.000Z';

export function fakeContext(overrides = {}) {
  const { files = ['src/a.ts', 'src/a.test.ts'], security = false, contract = {}, ancestor = true } = overrides;
  return {
    registry: {
      ids: [...ALWAYS_ON, ...Object.keys(CATEGORIES)],
      always_on: ALWAYS_ON,
      category: (id) => (ALWAYS_ON.includes(id) ? 'always-on' : CATEGORIES[id]),
      hasAnchor: (id) => id === 'context-engine',
      workerPacket: (id) => ({ id }),
    },
    effects: {
      changedFiles: () => files,
      diff: () => '',
      securityGate: () => ({ triggered: security, reasons: [], reason_count: security ? 1 : 0 }),
      contractGate: (_base, _head, id) => ({
        status: 'ran',
        result: {
          triggered: contract[id] === true,
          prior_semantic_pr_count: 1,
          history_status: 'complete',
          recent_semantic_changes: [],
        },
      }),
      isAncestor: () => ancestor,
      commitExists: () => true,
    },
  };
}

export function identityFor(ctx, overrides = {}) {
  return buildIdentity(
    {
      repo: 'grafana/grafana-pathfinder-app',
      pr: 42,
      pr_title: 'fix(lib): keep both writes',
      base_sha: BASE,
      head_sha: HEAD,
      reviewer: 'reviewer-bot',
      repo_dir: '/tmp/review-checkout',
      prior: null,
      ...overrides,
    },
    { effects: ctx.effects, sharedInputs: {}, tool: { commit: null, review_assets_dirty: null } }
  );
}

export function applyDrafts(state, drafts, ctx) {
  let working = state;
  for (const event of sealEvents(working, drafts, FIXED_TIME)) {
    working = applyEvent(working, event);
  }
  for (const event of advance(working, ctx, FIXED_TIME)) {
    working = applyEvent(working, event);
  }
  return working;
}

export function startSession(ctx, overrides = {}) {
  return applyDrafts(emptyState(), [{ type: 'session_started', data: { identity: identityFor(ctx, overrides) } }], ctx);
}

export function ready(state, role) {
  return state.order
    .map((id) => state.tasks[id])
    .filter((task) => task.status === 'ready' && (!role || task.role === role));
}

export function submit(state, task, result, ctx, receipt = {}) {
  const outcome = recordResult(state, {
    task_id: task.id,
    head: task.head,
    result,
    receipt: { host: 'test', agent_id: task.executor === 'agent' ? `agent-${task.id}` : null, ...receipt },
  });
  return outcome.draft ? applyDrafts(state, [outcome.draft], ctx) : state;
}

export function block(state, task, ctx, reason = 'the host has no Agent tool') {
  return applyDrafts(
    state,
    [recordBlocked(state, { task_id: task.id, head: task.head, reason, receipt: { host: 'test' } })],
    ctx
  );
}

export function waive(state, stage, ctx) {
  return applyDrafts(
    state,
    [recordWaiver(state, { stage, reason: 'user asked', user_consent: '"skip it" — the user' })],
    ctx
  );
}

export function completeCommand(state, task, ctx, evidence = {}) {
  return applyDrafts(
    state,
    [
      {
        type: 'task_completed',
        data: {
          task_id: task.id,
          result: {
            argv: task.spec.argv,
            exit_status: 0,
            stdout_ref: 'artifacts/x',
            stderr_ref: 'artifacts/y',
            cleanup: { removed: true },
            ...evidence,
          },
          result_hash: null,
          receipt: { host: 'controller', agent_id: null, provenance: 'controller_observed' },
        },
      },
    ],
    ctx
  );
}

export function observation(overrides = {}) {
  return {
    finding_id: 'lost-write',
    concern_id: 'correctness-and-reliability',
    kind: 'defect',
    severity: 'high',
    confidence: 'high',
    title: 'Concurrent removal drops a write',
    evidence: ['src/a.ts:10 overwrites the stored list'],
    why_it_matters: 'Two tabs completing steps lose one completion.',
    suggested_action: 'Merge with the stored value before writing.',
    reversibility: 'reversible',
    applies_to_files: ['src/a.ts'],
    origin: 'regression',
    impact: 'ordinary',
    timing: 'first_round',
    scope_effect: 'within_changed_surface',
    breaks_shipped_path: false,
    induced: false,
    ...overrides,
  };
}

export function routeResult(state, overrides = {}) {
  const task = ready(state, 'route')[0];
  const concerns = overrides.concerns ?? ALWAYS_ON.map((id) => ({ id, context: [{ path: 'src/a.ts', excerpt: 'x' }] }));
  return {
    change_class: overrides.change_class ?? 'product-runtime',
    concerns,
    file_coverage:
      overrides.file_coverage ??
      task.spec.changed_files.map((path) => ({ path, concern_ids: [concerns[0].id], reason: 'changed code' })),
    ...(overrides.concern_gaps ? { concern_gaps: overrides.concern_gaps } : {}),
  };
}

export const EVIDENCE_PLAN = {
  checks: [
    { name: 'unit_tests', argv: ['npx', 'jest', 'src/a.test.ts', '--coverage=false'] },
    { name: 'typecheck', argv: ['npm', 'run', 'typecheck'] },
    { name: 'lint', argv: ['npx', 'eslint', 'src/a.ts'] },
  ],
  efficacy: [
    {
      behavior: 'keeps both writes',
      test: 'src/a.test.ts',
      argv: ['npx', 'jest', 'src/a.test.ts', '--coverage=false'],
      revert_paths: ['src/a.ts'],
    },
  ],
};

function cleanFor(task) {
  return {
    no_findings: task.concern_ids
      .filter((id) => !id.startsWith('contract-evolution:'))
      .map((concern_id) => ({ concern_id, status: 'no_findings', reason: 'reviewed_clean' })),
    contract_packets: task.concern_ids
      .filter((id) => id.startsWith('contract-evolution:'))
      .map((id) => cleanPacket(id.slice('contract-evolution:'.length))),
  };
}

export function cleanPacket(concernId) {
  return {
    concern_id: concernId,
    origin_or_contract_anchor: 'anchor',
    current_contract_owner: 'owner',
    new_contract_delta: 'none',
    verdict: 'follows_contract',
    history_status: 'complete',
    use_ordinal: 'second',
    recent_semantic_changes: [],
    competing_owners_or_representations: [],
    branching_conditions: [],
    sources: [],
    has_recorded_anchor: true,
    anchor_violated: false,
    same_bug_count: 0,
  };
}

export function drive(state, ctx, answers = {}) {
  let working = state;
  for (let guard = 0; guard < 200; guard += 1) {
    const [task] = ready(working);
    if (!task) {
      return working;
    }
    const answer = answers[task.role];
    if (answer === 'stop') {
      return working;
    }
    if (typeof answer === 'function') {
      const next = answer(working, task);
      if (next === 'stop') {
        return working;
      }
      if (next !== undefined) {
        working = next;
        continue;
      }
    }
    working = defaultAnswer(working, task, ctx, answers);
  }
  throw new Error('drive did not settle');
}

function defaultAnswer(state, task, ctx, answers) {
  switch (task.role) {
    case 'route':
      return submit(state, task, routeResult(state, answers.routeOverrides), ctx);
    case 'contract_scan':
      return submit(
        state,
        task,
        {
          gates: task.spec.concerns.map(({ concern_id }) => ({
            concern_id,
            touches_anchor_with_consumers: false,
            context: [{ path: 'src/context-engine/a.ts', excerpt: 'x' }],
          })),
        },
        ctx
      );
    case 'evidence_plan':
      return submit(state, task, answers.evidencePlan ?? EVIDENCE_PLAN, ctx);
    case 'observer':
    case 'security_specialist':
    case 'root_overflow':
      return submit(state, task, cleanFor(task), ctx);
    case 'contract_specialist':
      return submit(state, task, { packet: cleanPacket(task.concern_ids[0].slice('contract-evolution:'.length)) }, ctx);
    case 'command':
      return completeCommand(
        state,
        task,
        ctx,
        task.spec.kind === 'efficacy' ? { exit_status: 1, failure_kind: 'assertion' } : {}
      );
    case 'synthesis':
      return submit(state, task, { merges: [], revisions: [], additions: answers.additions ?? [] }, ctx);
    case 'skeptic':
      return submit(
        state,
        task,
        {
          verdicts: task.spec.finding_ids.map((finding_id) => ({
            finding_id,
            verdict: 'confirmed',
            reason: 'checked src/a.ts:10',
          })),
        },
        ctx
      );
    case 'prior_check':
      return submit(
        state,
        task,
        {
          items: task.spec.items.map((item) => ({ ...item, status: 'fixed', evidence: ['re-checked at head'] })),
          cleared: [],
        },
        ctx
      );
    case 'check_resolution':
      return submit(state, task, { resolution: 'environment', reason: 'docker unavailable' }, ctx);
    default:
      throw new Error(`no default answer for ${task.role}`);
  }
}
