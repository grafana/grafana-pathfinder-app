import { buildReviewPlan } from '../concern-context.mjs';
import { buildObservation } from '../contract-evolution-policy.mjs';
import { advanceReviewPolicy, planVerificationBatches, reconcileReviewState } from '../review-policy.mjs';
import { normalizeClearedEntry, parseReviewState } from '../review-report.mjs';
import {
  applyEvent,
  CONTROLLER_VERSION,
  isProducer,
  makeTask,
  OBSERVER_ROLES,
  sealEvents,
  sha256,
  SESSION_SCHEMA_VERSION,
  SKIP_STAGES,
  tasksWhere,
  validateIdentity,
  validateReceipt,
  validateTaskResult,
} from './model.mjs';

const MAX_VERIFICATION_ROUNDS = 4;
const REVISABLE_ROLES = new Set(['observer', 'security_specialist', 'contract_specialist', 'root_overflow', 'skeptic']);
const CONTRACT_GATED_CATEGORIES = new Set(['subsystem', 'cross-cutting']);

export function resolvePrior({ reviewer, head, prior, effects }) {
  const count = prior?.count ?? 0;
  if (!Number.isInteger(count) || count < 0 || count > 99) {
    throw new Error('prior review count must be an integer from 0 to 99');
  }
  const base = {
    supplied: Boolean(prior?.body),
    author: prior?.author ?? null,
    body_sha256: prior?.body ? sha256(prior.body) : null,
    body_ref: prior?.body ? `artifacts/${sha256(prior.body)}.md` : null,
    provenance: prior?.body ? 'supervisor_supplied' : null,
    review_count: count,
  };
  const full = (reason, parsed = null) => ({
    mode: 'full',
    round: parsed?.version === 2 ? parsed.round + 1 : count + 1,
    prior: { ...base, state: null, fallback_reason: reason },
  });
  if (!prior?.body) {
    return full(count > 0 ? 'no prior review body supplied' : null);
  }
  if (prior.author !== reviewer) {
    return { ...full('the prior review is by another reviewer'), round: count + 1 };
  }
  const parsed = parseReviewState(prior.body);
  if (!parsed) {
    return full('the prior review has no valid trailing state marker');
  }
  if (parsed.truncated) {
    return full('the prior state marker is truncated', parsed);
  }
  if (!effects.commitExists(parsed.reviewed_head) || !effects.isAncestor(parsed.reviewed_head, head)) {
    return full('the prior reviewed head is not an ancestor of the current head', parsed);
  }
  return {
    mode: 'incremental',
    round: parsed.version === 2 ? parsed.round + 1 : count + 1,
    prior: { ...base, state: parsed, fallback_reason: null },
  };
}

export function buildIdentity(input, { effects, sharedInputs, tool }) {
  const { mode, round, prior } = resolvePrior({
    reviewer: input.reviewer,
    head: input.head_sha,
    prior: input.prior,
    effects,
  });
  if (round > 100) {
    throw new Error('round must be at most 100');
  }
  const core = {
    schema_version: SESSION_SCHEMA_VERSION,
    controller_version: CONTROLLER_VERSION,
    repo: input.repo,
    pr: input.pr,
    pr_title: input.pr_title,
    base_sha: input.base_sha,
    head_sha: input.head_sha,
    reviewer: input.reviewer,
    mode,
    round,
    prior,
    repo_dir: input.repo_dir,
    shared_inputs: sharedInputs,
    tool_revision: tool,
  };
  validateIdentity(core);
  if (typeof core.pr_title !== 'string' || core.pr_title.trim().length === 0) {
    throw new Error('pr title must be a non-empty string');
  }
  const fingerprint = sha256({ ...core, tool_revision: null }).slice(0, 10);
  return { ...core, session_id: `pr${input.pr}-${input.head_sha.slice(0, 12)}-r${round}-${fingerprint}` };
}

function priorItems(identity) {
  const state = identity.prior.state;
  if (!state) {
    return [];
  }
  return [
    ...state.blocking_findings.map(({ id, concern_id }) => ({ id, concern_id, kind: 'blocking' })),
    ...state.deferred.map(({ id, concern_id }) => ({ id, concern_id, kind: 'deferred' })),
  ];
}

function priorDeferred(identity) {
  return identity.prior.state?.deferred ?? [];
}

function priorCleared(identity) {
  return identity.prior.state?.cleared ?? [];
}

function reviewRange(identity) {
  return identity.mode === 'incremental'
    ? { from: identity.prior.state.reviewed_head, to: identity.head_sha }
    : { from: identity.base_sha, to: identity.head_sha };
}

function onlyTask(state, role) {
  return tasksWhere(state, (task) => task.role === role)[0] ?? null;
}

const resolved = (task) => task.status !== 'ready';

function commandOutcome(task) {
  const evidence = task.result;
  if (!evidence) {
    return null;
  }
  if (evidence.error) {
    return 'error';
  }
  if (task.spec.kind === 'probe') {
    return (evidence.exit_status === 0) === (task.spec.expect === 'exit_zero') ? 'ok' : 'mismatch';
  }
  if (task.spec.kind === 'check') {
    return evidence.exit_status === 0 ? 'ok' : 'fail';
  }
  return 'ok';
}

function routedConcerns(state) {
  return onlyTask(state, 'route')?.result?.concerns ?? [];
}

function stageScope(state, ctx) {
  if (state.scope) {
    return [];
  }
  const range = reviewRange(state.identity);
  const files = ctx.effects.changedFiles(range.from, range.to);
  return [
    { type: 'scope_recorded', data: { range, files } },
    {
      type: 'gate_recorded',
      data: { gate: 'security', result: { range, ...ctx.effects.securityGate(range.from, range.to) } },
    },
  ];
}

function stagePriorCheck(state) {
  const items = priorItems(state.identity);
  if (state.identity.mode !== 'incremental' || items.length === 0 || onlyTask(state, 'prior_check')) {
    return [];
  }
  return [
    task(state, {
      role: 'prior_check',
      stage: 'verify_prior',
      spec: { items, reviewed_head: state.identity.prior.state.reviewed_head },
    }),
  ];
}

function stageRoute(state, ctx) {
  const prior = onlyTask(state, 'prior_check');
  const needsPrior = state.identity.mode === 'incremental' && priorItems(state.identity).length > 0;
  if (onlyTask(state, 'route') || (needsPrior && prior?.status !== 'completed')) {
    return [];
  }
  const required = new Map();
  if (state.gates.security.triggered) {
    required.set('security', 'the security gate triggered');
  }
  for (const item of prior?.result.items ?? []) {
    if (item.kind === 'blocking' && item.status === 'unresolved') {
      required.set(item.concern_id, `it owns unresolved prior blocker ${item.id}`);
    }
  }
  return [
    task(state, {
      role: 'route',
      stage: 'route',
      prerequisites: prior ? [prior.id] : [],
      spec: {
        mode: state.identity.mode,
        range: state.scope.range,
        changed_files: state.scope.files,
        registry: ctx.registry.ids,
        always_on: ctx.registry.always_on,
        required_concerns: [...required.keys()],
        required_reasons: Object.fromEntries(required),
        security_gate: state.gates.security,
      },
    }),
  ];
}

function stageContractGates(state, ctx) {
  const route = onlyTask(state, 'route');
  if (route?.status !== 'completed' || state.gates.contract_done) {
    return [];
  }
  const events = [];
  for (const { id } of route.result.concerns) {
    if (!CONTRACT_GATED_CATEGORIES.has(ctx.registry.category(id))) {
      continue;
    }
    const outcome = ctx.effects.contractGate(state.identity.base_sha, state.identity.head_sha, id);
    events.push({ type: 'gate_recorded', data: { gate: 'contract', concern_id: id, outcome } });
  }
  events.push({ type: 'contract_gates_completed', data: {} });
  return events;
}

function gatedConcerns(state, ctx) {
  return Object.entries(state.gates.contract)
    .filter(([id, outcome]) => outcome.status === 'ran' && (outcome.result.triggered || ctx.registry.hasAnchor(id)))
    .map(([id, outcome]) => ({
      concern_id: id,
      has_anchor: ctx.registry.hasAnchor(id),
      gate_triggered: outcome.result.triggered,
      prior_semantic_pr_count: outcome.result.prior_semantic_pr_count,
      history_status: outcome.result.history_status,
      recent_semantic_changes: outcome.result.recent_semantic_changes,
    }));
}

function stageContractScan(state, ctx) {
  if (!state.gates.contract_done || onlyTask(state, 'contract_scan')) {
    return [];
  }
  const concerns = gatedConcerns(state, ctx);
  if (concerns.length === 0) {
    return [];
  }
  return [
    task(state, {
      role: 'contract_scan',
      stage: 'contract_evolution',
      prerequisites: [onlyTask(state, 'route').id],
      spec: { concerns },
    }),
  ];
}

function firedGates(state, ctx) {
  const scan = onlyTask(state, 'contract_scan');
  return gatedConcerns(state, ctx)
    .map((gate) => {
      const answer = scan?.result?.gates.find(({ concern_id }) => concern_id === gate.concern_id);
      return {
        concern_id: gate.concern_id,
        fired: gate.gate_triggered || answer?.touches_anchor_with_consumers === true,
        touches_anchor_with_consumers: answer?.touches_anchor_with_consumers === true,
        prior_semantic_pr_count: gate.prior_semantic_pr_count,
        context: answer?.context ?? [],
      };
    })
    .filter(({ fired }) => fired)
    .map(({ fired: _fired, ...gate }) => gate);
}

function stagePlan(state, ctx) {
  const route = onlyTask(state, 'route');
  if (state.plan || route?.status !== 'completed' || !state.gates.contract_done) {
    return [];
  }
  const scan = onlyTask(state, 'contract_scan');
  if (gatedConcerns(state, ctx).length > 0 && scan?.status !== 'completed') {
    return [];
  }
  const securityTriggered = state.gates.security.triggered;
  const input = {
    mode: state.identity.mode,
    concerns: route.result.concerns.map(({ id, context }) => ({
      id,
      category: ctx.registry.category(id),
      context,
      ...(securityTriggered && id === 'security' ? { specialist: 'security' } : {}),
    })),
    contract_evolution: firedGates(state, ctx),
  };
  const plan = buildReviewPlan(input);
  const prerequisites = [route.id, ...(scan ? [scan.id] : [])];
  const drafts = [{ type: 'plan_recorded', data: { input, plan } }];
  let working = state;
  const push = (spec) => {
    const draft = task(working, spec);
    working = applyDraft(working, draft);
    drafts.push(draft);
  };
  for (const worker of plan.workers) {
    const role =
      worker.kind === 'security'
        ? 'security_specialist'
        : worker.kind === 'contract_evolution'
          ? 'contract_specialist'
          : 'observer';
    const concernIds =
      worker.kind === 'contract_evolution'
        ? worker.concern_ids.map((id) => `contract-evolution:${id}`)
        : worker.concern_ids;
    const gate = worker.kind === 'contract_evolution' ? state.gates.contract[worker.concern_ids[0]].result : null;
    push({
      role,
      stage: 'observe',
      label: worker.id,
      concern_ids: concernIds,
      prerequisites,
      spec: { worker_id: worker.id, files: worker.files, context: worker.context, contract_gate: gate },
    });
  }
  if (plan.root.concern_ids.length > 0) {
    const contexts = Object.fromEntries(route.result.concerns.map(({ id, context }) => [id, context]));
    for (const gate of input.contract_evolution) {
      contexts[`contract-evolution:${gate.concern_id}`] = gate.context;
    }
    push({
      role: 'root_overflow',
      stage: 'observe',
      concern_ids: plan.root.concern_ids,
      prerequisites,
      spec: {
        contexts: Object.fromEntries(plan.root.concern_ids.map((id) => [id, contexts[id] ?? []])),
        contract_gates: Object.fromEntries(
          plan.root.concern_ids
            .filter((id) => id.startsWith('contract-evolution:'))
            .map((id) => [id, state.gates.contract[id.slice('contract-evolution:'.length)]?.result ?? null])
        ),
      },
    });
  }
  return drafts;
}

function stageEvidencePlan(state) {
  const route = onlyTask(state, 'route');
  if (route?.status !== 'completed' || onlyTask(state, 'evidence_plan')) {
    return [];
  }
  return [
    task(state, {
      role: 'evidence_plan',
      stage: 'evidence',
      prerequisites: [route.id],
      spec: {
        mode: state.identity.mode,
        change_class: route.result.change_class,
        changed_files: state.scope.files,
      },
    }),
  ];
}

function commandTasks(state) {
  return tasksWhere(state, (candidate) => candidate.role === 'command');
}

function stageCommands(state) {
  const plan = onlyTask(state, 'evidence_plan');
  if (plan?.status !== 'completed' || commandTasks(state).some(({ spec }) => spec.source === plan.id)) {
    return [];
  }
  const drafts = [];
  let working = state;
  const push = (spec) => {
    const draft = task(working, spec);
    working = applyDraft(working, draft);
    drafts.push(draft);
  };
  for (const check of plan.result.checks.filter(({ runs }) => runs)) {
    for (const [run, argv] of check.runs.entries()) {
      push({
        role: 'command',
        stage: check.name,
        label: check.runs.length > 1 ? `${check.name}-${run + 1}` : check.name,
        prerequisites: [plan.id],
        spec: { kind: 'check', source: plan.id, name: check.name, run, argv, at: 'head' },
      });
    }
  }
  for (const [index, entry] of plan.result.efficacy.entries()) {
    if (!entry.argv) {
      continue;
    }
    push({
      role: 'command',
      stage: 'test_efficacy',
      label: `efficacy-${index + 1}`,
      prerequisites: [plan.id],
      spec: {
        kind: 'efficacy',
        source: plan.id,
        behavior: entry.behavior,
        test: entry.test,
        argv: entry.argv,
        revert_paths: entry.revert_paths,
        at: 'head',
      },
    });
  }
  return drafts;
}

function stageProducerFollowUps(state) {
  for (const producer of tasksWhere(
    state,
    (candidate) => isProducer(candidate.role) && candidate.status === 'completed'
  )) {
    const recorded = state.observation_order.some(
      (ref) =>
        state.observations[ref].source_task === producer.id &&
        state.observations[ref].source_hash === producer.result_hash
    );
    const expected = producerObservations(producer);
    if (expected.length > 0 && !recorded) {
      let index = state.observation_order.length;
      return [
        {
          type: 'observations_recorded',
          data: {
            source_task: producer.id,
            source_hash: producer.result_hash,
            observations: expected.map((observation) => {
              index += 1;
              return { ref: `o${String(index).padStart(3, '0')}`, observation };
            }),
          },
        },
      ];
    }
    const probes = producer.result.probes ?? [];
    const created = commandTasks(state).filter(({ spec }) => spec.source === producer.id);
    if (probes.length > 0 && created.length === 0) {
      const drafts = [];
      let working = state;
      for (const probe of probes) {
        const draft = task(working, {
          role: 'command',
          stage: 'probe',
          label: probe.probe_id,
          prerequisites: [producer.id],
          spec: { kind: 'probe', source: producer.id, at: 'head', ...probe },
        });
        working = applyDraft(working, draft);
        drafts.push(draft);
      }
      return drafts;
    }
  }
  return [];
}

export function producerObservations(producer) {
  const result = producer.result;
  const fromPackets = [...(result.contract_packets ?? []), ...(result.packet ? [result.packet] : [])]
    .map((packet) => buildObservation(packet))
    .filter(Boolean);
  return [...(result.observations ?? []), ...fromPackets];
}

function resolutionsFor(state, commandId) {
  return tasksWhere(
    state,
    (candidate) => candidate.role === 'check_resolution' && candidate.spec.command_task === commandId
  );
}

function baselineFor(state, resolutionId) {
  return commandTasks(state).find(({ spec }) => spec.kind === 'baseline' && spec.source === resolutionId) ?? null;
}

function stageResolutions(state) {
  for (const command of commandTasks(state).filter(({ status }) => status === 'completed')) {
    const outcome = commandOutcome(command);
    if (!['fail', 'mismatch'].includes(outcome)) {
      continue;
    }
    const resolutions = resolutionsFor(state, command.id);
    const latest = resolutions.at(-1);
    const base = {
      role: 'check_resolution',
      stage: command.spec.kind === 'probe' ? 'probe' : command.spec.name,
      label: command.spec.name ?? command.spec.probe_id,
      prerequisites: [command.id],
    };
    const spec = {
      command_task: command.id,
      kind: command.spec.kind,
      name: command.spec.name ?? command.spec.probe_id,
      argv: command.spec.argv,
      exit_status: command.result.exit_status,
      stdout_ref: command.result.stdout_ref,
      stderr_ref: command.result.stderr_ref,
      failure_kind: command.result.failure_kind ?? null,
      changed_files: state.scope.files,
    };
    if (!latest) {
      const allowed =
        command.spec.kind === 'probe'
          ? ['observation', 'claim_refuted', 'environment']
          : ['observation', 'baseline_failure', 'environment'];
      return [task(state, { ...base, spec: { ...spec, attempt: 1, allowed } })];
    }
    if (latest.status !== 'completed' || latest.result.resolution !== 'baseline_failure') {
      continue;
    }
    const baseline = baselineFor(state, latest.id);
    if (!baseline) {
      return [
        task(state, {
          role: 'command',
          stage: command.spec.name,
          label: `baseline-${command.spec.name}`,
          prerequisites: [latest.id],
          spec: {
            kind: 'baseline',
            source: latest.id,
            head_command: command.id,
            name: command.spec.name,
            argv: command.spec.argv,
            at: 'base',
            signature: latest.result.signature,
            preserve_paths: latest.result.preserve_paths,
          },
        }),
      ];
    }
    if (
      baseline.status === 'completed' &&
      baseline.result.match?.matched !== true &&
      resolutions.length === latest.spec.attempt
    ) {
      return [
        task(state, {
          ...base,
          prerequisites: [baseline.id],
          spec: {
            ...spec,
            attempt: latest.spec.attempt + 1,
            allowed: ['observation', 'environment'],
            rejected_baseline: {
              task: baseline.id,
              reason:
                baseline.result.match?.reason ??
                baseline.result.error ??
                'the baseline run did not reproduce the failure',
            },
          },
        }),
      ];
    }
  }
  return [];
}

function stageSynthesis(state) {
  if (!state.plan || onlyTask(state, 'synthesis')) {
    return [];
  }
  const open = tasksWhere(state, (candidate) => candidate.role !== 'synthesis' && candidate.role !== 'skeptic');
  if (open.some((candidate) => !resolved(candidate))) {
    return [];
  }
  const refs = liveRefs(state);
  return [
    task(state, {
      role: 'synthesis',
      stage: 'synthesis',
      prerequisites: open.map(({ id }) => id),
      spec: { refs, routed: routedConcerns(state).map(({ id }) => id) },
    }),
  ];
}

function stageAdmit(state) {
  const synthesis = onlyTask(state, 'synthesis');
  if (synthesis?.status !== 'completed' || state.admitted) {
    return [];
  }
  return [{ type: 'synthesis_applied', data: admitObservations(state, synthesis.result) }];
}

export function liveRefs(state) {
  return state.observation_order.filter((ref) => !state.observations[ref].superseded);
}

export function admitObservations(state, result) {
  const merged = new Set(result.merges.map(({ ref }) => ref));
  const revised = new Map(result.revisions.map(({ ref, observation }) => [ref, observation]));
  const kept = liveRefs(state)
    .filter((ref) => !merged.has(ref))
    .map((ref) => ({ ref, observation: revised.get(ref) ?? state.observations[ref].observation }));
  let index = state.observation_order.length;
  const additions = result.additions.map((observation) => {
    index += 1;
    return { ref: `o${String(index).padStart(3, '0')}`, observation, added_by_synthesis: true };
  });
  const admitted = [...kept, ...additions];
  const seen = new Map();
  for (const { ref, observation } of admitted) {
    if (seen.has(observation.finding_id)) {
      throw new Error(
        `synthesis leaves finding_id ${observation.finding_id} on both ${seen.get(observation.finding_id)} and ${ref}. Merge them or revise one to a distinct stable ID`
      );
    }
    seen.set(observation.finding_id, ref);
  }
  return { admitted, merges: result.merges, revisions: result.revisions, additions };
}

function policyRequest(state, observation) {
  return {
    observation,
    verdicts: state.verdicts[observation.finding_id] ?? [],
    round: state.identity.round,
    prior_deferred: priorDeferred(state.identity),
    prior_cleared: priorCleared(state.identity),
  };
}

export function evaluatePolicy(state) {
  return Object.fromEntries(
    state.admitted.map(({ observation }) => {
      try {
        const outcome = advanceReviewPolicy(policyRequest(state, observation));
        const { observation: _observation, ...rest } = outcome;
        return [observation.finding_id, rest];
      } catch (error) {
        return [observation.finding_id, { status: 'rejected', error: error.message }];
      }
    })
  );
}

function stagePolicy(state) {
  if (!state.admitted || state.policy) {
    return [];
  }
  const open = state.rounds.at(-1);
  if (open && !open.closed) {
    const tasks = open.task_ids.map((id) => state.tasks[id]);
    if (tasks.some((candidate) => candidate.status !== 'completed')) {
      return [];
    }
    const appended = {};
    const ordered = [...tasks].sort((left, right) => left.spec.independent_role - right.spec.independent_role);
    for (const batch of ordered) {
      for (const { finding_id, verdict, reason } of batch.result.verdicts) {
        appended[finding_id] = [...(appended[finding_id] ?? []), { verdict, reason }];
      }
    }
    return [{ type: 'verification_round_closed', data: { index: open.index, appended } }];
  }
  const results = evaluatePolicy(state);
  const pending = state.admitted.filter(
    ({ observation }) => results[observation.finding_id].status === 'needs_verification'
  );
  if (pending.length === 0) {
    return [{ type: 'policy_completed', data: { results } }];
  }
  if (state.rounds.length >= MAX_VERIFICATION_ROUNDS) {
    throw new Error('verification did not converge within the policy facade round limit');
  }
  const batches = planVerificationBatches(pending.map(({ observation }) => policyRequest(state, observation)));
  const index = state.rounds.length;
  const synthesis = onlyTask(state, 'synthesis');
  const drafts = [];
  let working = state;
  for (const batch of batches) {
    const draft = task(working, {
      role: 'skeptic',
      stage: 'verify',
      label: `${batch.role}-${batch.independent_role}`,
      concern_ids: [batch.concern_id],
      prerequisites: [synthesis.id],
      spec: { ...batch, verification_role: batch.role, round_index: index },
    });
    working = applyDraft(working, draft);
    drafts.push(draft);
  }
  drafts.push({
    type: 'verification_round_opened',
    data: { index, task_ids: drafts.map(({ data }) => data.task.id) },
  });
  return drafts;
}

function stageReconcile(state) {
  if (!state.policy || state.reconciliation) {
    return [];
  }
  const prior = onlyTask(state, 'prior_check');
  const items = prior?.result?.items ?? [];
  const input = {
    prior_deferred: priorDeferred(state.identity),
    current_follow_ups: state.admitted
      .filter(({ observation }) => state.policy[observation.finding_id]?.decision?.disposition === 'follow_up')
      .map(({ observation }) => ({ id: observation.finding_id, concern_id: observation.concern_id })),
    verified_fixed_ids: items
      .filter(({ kind, status }) => kind === 'deferred' && status === 'fixed')
      .map(({ id }) => id),
    prior_cleared: priorCleared(state.identity),
    current_cleared: (prior?.result?.cleared ?? []).map(({ for_id: _forId, ...entry }) => entry),
  };
  return [{ type: 'reconciled', data: { input, output: reconcileReviewState(input) } }];
}

const STAGES = [
  stageScope,
  stagePriorCheck,
  stageRoute,
  stageContractGates,
  stageContractScan,
  stagePlan,
  stageEvidencePlan,
  stageCommands,
  stageProducerFollowUps,
  stageResolutions,
  stageSynthesis,
  stageAdmit,
  stagePolicy,
  stageReconcile,
];

function task(state, spec) {
  return { type: 'task_created', data: { task: makeTask(state, spec) } };
}

function applyDraft(state, draft) {
  const [event] = sealEvents(state, [draft]);
  return applyEvent(state, event);
}

export function advance(state, ctx, now) {
  let working = state;
  const events = [];
  for (let guard = 0; guard < 500; guard += 1) {
    if (working.finalized?.complete) {
      return events;
    }
    const drafts = STAGES.reduce((found, stage) => (found.length > 0 ? found : stage(working, ctx)), []);
    if (drafts.length === 0) {
      return events;
    }
    const sealed = sealEvents(working, drafts, now);
    for (const event of sealed) {
      working = applyEvent(working, event);
    }
    events.push(...sealed);
  }
  throw new Error('the controller did not reach a fixed point');
}

function skepticAgentConflict(state, target, agentId) {
  if (agentId === null) {
    return null;
  }
  const findings = new Set(target.spec.finding_ids);
  return (
    tasksWhere(
      state,
      (candidate) =>
        candidate.role === 'skeptic' &&
        candidate.id !== target.id &&
        candidate.status === 'completed' &&
        candidate.receipt?.agent_id === agentId &&
        candidate.spec.finding_ids.some((id) => findings.has(id))
    )[0] ?? null
  );
}

function consumed(state, target) {
  if (tasksWhere(state, (candidate) => candidate.prerequisites.includes(target.id)).length > 0) {
    return true;
  }
  if (target.role === 'skeptic') {
    return state.rounds[target.spec.round_index]?.closed === true;
  }
  return false;
}

function normalizePriorCleared(result) {
  return {
    ...result,
    cleared: result.cleared.map((entry) => ({ ...normalizeClearedEntry(entry), for_id: entry.for_id })),
  };
}

export function recordResult(state, { task_id, head, result, receipt, revise_reason }) {
  if (head !== state.identity.head_sha) {
    throw new Error(
      `result is pinned to ${head}, but this session reviews ${state.identity.head_sha}. A new head needs a new session`
    );
  }
  const target = state.tasks[task_id];
  if (!target) {
    throw new Error(`task ${task_id} does not exist in session ${state.identity.session_id}`);
  }
  if (target.status === 'blocked') {
    throw new Error(`task ${task_id} is blocked; start a new session to retry it`);
  }
  let normalized = validateTaskResult(target, result);
  if (target.role === 'prior_check') {
    normalized = normalizePriorCleared(normalized);
  }
  if (isProducer(target.role)) {
    producerObservations({ result: normalized });
  }
  if (target.role === 'synthesis') {
    admitObservations(state, normalized);
  }
  const hash = sha256(normalized);
  const checkedReceipt = validateReceipt(receipt, target);
  if (target.role === 'skeptic') {
    const conflict = skepticAgentConflict(state, target, checkedReceipt.agent_id);
    if (conflict) {
      throw new Error(
        `agent ${checkedReceipt.agent_id} already returned verdicts on these findings in ${conflict.id}. Independent skeptic roles must run on different agents`
      );
    }
  }
  if (target.status === 'completed') {
    if (target.result_hash === hash) {
      return { events: [], output: { task_id, status: 'already_recorded' } };
    }
    if (!revise_reason) {
      throw new Error(
        `task ${task_id} already has a different result. Pass --revise with a reason to replace it before anything consumes it`
      );
    }
    if (!REVISABLE_ROLES.has(target.role) || consumed(state, target)) {
      throw new Error(`task ${task_id} has already been consumed downstream; start a new session to change it`);
    }
    return {
      draft: {
        type: 'task_revised',
        data: { task_id, result: normalized, result_hash: hash, receipt: checkedReceipt, reason: revise_reason },
      },
      output: { task_id, status: 'revised' },
    };
  }
  return {
    draft: {
      type: 'task_completed',
      data: { task_id, result: normalized, result_hash: hash, receipt: checkedReceipt },
    },
    output: { task_id, status: 'recorded' },
  };
}

export function recordBlocked(state, { task_id, head, reason, receipt }) {
  if (head !== state.identity.head_sha) {
    throw new Error(`blocked report is pinned to ${head}, but this session reviews ${state.identity.head_sha}`);
  }
  const target = state.tasks[task_id];
  if (!target || target.status !== 'ready') {
    throw new Error(`task ${task_id} is not ready`);
  }
  if (typeof reason !== 'string' || reason.trim().length === 0 || reason.length > 300) {
    throw new Error('a blocked task needs a one-line reason of at most 300 characters');
  }
  return {
    type: 'task_blocked',
    data: { task_id, reason: reason.trim(), receipt: { host: receipt.host ?? 'unspecified' } },
  };
}

export function recordWaiver(state, { stage, reason, user_consent }) {
  if (!SKIP_STAGES.includes(stage)) {
    throw new Error(`only these stages can be waived: ${SKIP_STAGES.join(', ')}`);
  }
  for (const [field, value] of [
    ['reason', reason],
    ['user consent', user_consent],
  ]) {
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > 300) {
      throw new Error(`a waiver needs a ${field} of at most 300 characters`);
    }
  }
  if (state.waivers[stage]) {
    throw new Error(`stage ${stage} is already waived`);
  }
  return {
    type: 'waiver_recorded',
    data: { stage, reason: reason.trim(), user_consent: user_consent.trim(), recorded_by: 'supervisor' },
  };
}

export { commandOutcome, onlyTask, resolutionsFor, baselineFor, OBSERVER_ROLES };
