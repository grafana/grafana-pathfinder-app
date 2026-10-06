import { normalizeStageLedger } from '../review-ledger.mjs';
import { renderReviewReport } from '../review-report.mjs';
import {
  baselineFor,
  commandOutcome,
  efficacyRecords,
  evaluatePolicy,
  onlyTask,
  resolutionsFor,
} from './controller.mjs';
import { OBSERVER_ROLES, tasksWhere } from './model.mjs';

const BEHAVIOR_CLASSES = new Set(['product-runtime', 'contracts-and-schemas', 'mixed']);
const WAIVABLE_BY_TASK = {
  observer: 'workers',
  contract_specialist: 'workers',
  security_specialist: 'security_specialist',
  skeptic: 'skeptic_batches',
};

function waiverFor(task) {
  if (task.role === 'command') {
    return task.spec.kind === 'check' ? task.spec.name : task.spec.kind === 'efficacy' ? 'test_efficacy' : null;
  }
  return WAIVABLE_BY_TASK[task.role] ?? null;
}

function checkResolution(state, command) {
  const latest = resolutionsFor(state, command.id).at(-1);
  if (!latest) {
    return { resolved: false, why: 'it has no resolution yet' };
  }
  if (latest.status !== 'completed') {
    return { resolved: false, why: `resolution ${latest.id} is ${latest.status}` };
  }
  const { resolution, reason } = latest.result;
  if (resolution === 'observation' || resolution === 'claim_refuted') {
    return { resolved: true, resolution };
  }
  if (resolution === 'environment') {
    return { resolved: false, why: `it was attributed to the environment (${reason}); verification is incomplete` };
  }
  const baseline = baselineFor(state, latest.id);
  if (baseline?.status === 'completed' && baseline.result.match?.matched === true) {
    return { resolved: true, resolution: 'verified_baseline_failure' };
  }
  if (baseline?.status === 'completed') {
    return {
      resolved: false,
      why: `its baseline run did not reproduce the failure (${baseline.result.match?.reason ?? baseline.result.error ?? 'no comparison'})`,
    };
  }
  return { resolved: false, why: 'its baseline-failure claim is not verified yet' };
}

export function obligations(state) {
  const open = [];
  const add = (stage, message) => open.push({ stage, message });
  if (!state.identity) {
    return [{ stage: 'session', message: 'the session has not started' }];
  }
  for (const task of tasksWhere(state, (candidate) => candidate.status !== 'completed')) {
    const waiver = waiverFor(task);
    if (waiver && state.waivers[waiver]) {
      continue;
    }
    const why = task.status === 'blocked' ? `blocked: ${task.blocked_reason}` : 'not finished';
    add(task.stage, `${task.id} (${task.role}) is ${why}`);
  }
  for (const command of tasksWhere(state, (task) => task.role === 'command' && task.status === 'completed')) {
    const outcome = commandOutcome(command);
    if (outcome === 'error') {
      add(command.stage, `${command.id} could not run: ${command.result.error}`);
    }
    if (outcome === 'fail' || outcome === 'mismatch') {
      const resolution = checkResolution(state, command);
      if (!resolution.resolved) {
        add(
          command.stage,
          `${command.id} ${outcome === 'fail' ? 'failed' : 'contradicted its probe claim'}, and ${resolution.why}`
        );
      }
    }
    if (command.result.cleanup && !command.result.cleanup.removed) {
      add(command.stage, `${command.id} left its disposable worktree at ${command.result.cleanup.path}`);
    }
  }
  const route = onlyTask(state, 'route');
  if (!route || route.status !== 'completed') {
    if (!route) {
      add('route', 'routing has not been created');
    }
    return open;
  }
  if (!state.plan) {
    add('plan', 'the planner has not run');
  }
  if (!onlyTask(state, 'synthesis')) {
    add('synthesis', 'root synthesis has not been created');
  }
  if (state.admitted && !state.policy) {
    add('policy', 'review-policy.mjs has not resolved every observation');
  }
  for (const [findingId, result] of Object.entries(state.policy ?? {})) {
    if (result.status === 'rejected') {
      add('policy', `the policy facade rejected ${findingId}: ${result.error}`);
    }
  }
  if (state.policy && !state.reconciliation) {
    add('reconcile', 'reconciliation has not run');
  }
  if (open.length === 0) {
    try {
      normalizeStageLedger(deriveStageLedger(state));
    } catch (error) {
      add('ledger', error.message);
    }
  }
  return open;
}

function commandString(argv) {
  return argv.map((arg) => (/^[A-Za-z0-9_./:=@%+-]+$/.test(arg) ? arg : JSON.stringify(arg))).join(' ');
}

function deriveChecks(state) {
  const plan = onlyTask(state, 'evidence_plan');
  if (plan?.status !== 'completed') {
    return [];
  }
  return plan.result.checks.flatMap((check) => {
    if (check.status === 'not_applicable') {
      return [{ name: check.name, status: 'not_applicable', reason: check.reason }];
    }
    const commands = tasksWhere(
      state,
      (task) => task.role === 'command' && task.spec.kind === 'check' && task.spec.name === check.name
    );
    if (commands.length === 0 || commands.some((command) => command.status !== 'completed' || command.result.error)) {
      return [];
    }
    const text = check.runs.map(commandString).join(' && ');
    return [
      {
        name: check.name,
        status: commands.every((command) => command.result.exit_status === 0) ? 'pass' : 'fail',
        command: text.length > 300 ? `${text.slice(0, 299)}…` : text,
      },
    ];
  });
}

function dispositionNote(entry) {
  return entry.finding_id !== undefined ? `finding ${entry.finding_id}` : entry.reason;
}

function deriveEfficacy(state) {
  const dispositions = onlyTask(state, 'synthesis')?.result?.efficacy_dispositions ?? [];
  return efficacyRecords(state).map(({ behavior, test, result, evidence }) => {
    const disposition = dispositions.find((entry) => entry.behavior === behavior);
    return {
      behavior,
      test,
      result,
      ...(evidence === null ? {} : { evidence }),
      ...(disposition ? { disposition_note: dispositionNote(disposition) } : {}),
    };
  });
}

export function deriveStageLedger(state) {
  const route = onlyTask(state, 'route');
  const observers = tasksWhere(state, (task) => OBSERVER_ROLES.has(task.role));
  const skeptics = tasksWhere(state, (task) => task.role === 'skeptic');
  const admitted = state.admitted ?? [];
  const policy = state.policy ?? {};
  const securityWorker = observers.find((task) => task.role === 'security_specialist');
  return {
    mode: state.identity.mode,
    change_class: route?.result?.change_class ?? 'mixed',
    surfaces: { go: state.scope?.surfaces?.go === true },
    workers: {
      planned: state.plan?.plan.workers.length ?? 0,
      run: observers.filter((t) => t.status === 'completed').length,
    },
    skeptic_batches: { required: skeptics.length, run: skeptics.filter((t) => t.status === 'completed').length },
    observations: {
      total: admitted.length,
      through_policy: admitted.filter(({ observation }) =>
        ['final', 'dropped'].includes(policy[observation.finding_id]?.status)
      ).length,
    },
    security: {
      gate_triggered: state.gates.security?.triggered === true,
      specialist_ran: securityWorker?.status === 'completed',
    },
    checks: deriveChecks(state),
    efficacy: deriveEfficacy(state),
    skipped: Object.values(state.waivers).map(({ stage, reason, user_consent }) => ({ stage, reason, user_consent })),
  };
}

function findingsFrom(state, policy) {
  return (state.admitted ?? []).flatMap(({ observation }) => {
    const result = policy[observation.finding_id];
    if (result?.status !== 'final') {
      return [];
    }
    return [
      {
        id: observation.finding_id,
        concern_id: observation.concern_id,
        disposition: result.decision.disposition,
        severity: observation.severity,
        title: observation.title,
        problem: observation.why_it_matters,
        suggested_action: observation.suggested_action,
        reversibility: observation.reversibility,
      },
    ];
  });
}

export function deriveFindings(state) {
  if (state.policy) {
    return findingsFrom(state, state.policy);
  }
  return state.admitted ? findingsFrom(state, evaluatePolicy(state)) : [];
}

function incompleteReason(open) {
  const first = open[0];
  const more = open.length > 1 ? ` (+${open.length - 1} more open obligations)` : '';
  const reason = `${first.stage}: ${first.message}`.replace(/\s+/g, ' ');
  const budget = 240 - more.length;
  return `${reason.length > budget ? `${reason.slice(0, budget - 1)}…` : reason}${more}`;
}

export function buildReport(state) {
  const open = obligations(state);
  const complete = open.length === 0;
  const { identity } = state;
  const findings = deriveFindings(state);
  const deferred = state.reconciliation?.output.next_deferred ?? [];
  const cleared = state.reconciliation?.output.next_cleared ?? [];
  const deferredIds = new Set(deferred.map(({ id }) => id));
  const report = {
    pr_url: `https://github.com/${identity.repo}/pull/${identity.pr}`,
    pr_title: identity.pr_title,
    reviewed_head: identity.head_sha,
    round: identity.round,
    findings: complete ? findings : findings.filter((f) => f.disposition !== 'follow_up' || deferredIds.has(f.id)),
    deferred,
    cleared,
    assessment: complete ? { status: 'complete' } : { status: 'incomplete', reason: incompleteReason(open) },
    ...(complete ? { stage_ledger: deriveStageLedger(state) } : {}),
  };
  return { report, open };
}

export function renderSession(state) {
  const { report, open } = buildReport(state);
  return { report, open, rendered: renderReviewReport(report) };
}

export function priorBlockerChanges(state) {
  const prior = state.identity?.prior.state?.blocking_findings ?? [];
  const check = onlyTask(state, 'prior_check')?.result;
  return prior.flatMap(({ id, concern_id: concernId }) => {
    const item = check?.items.find((candidate) => candidate.id === id && candidate.kind === 'blocking');
    if (item?.status !== 'unresolved' || !state.policy) {
      return [];
    }
    const result = state.policy[id];
    const now = result?.status === 'final' ? result.decision.disposition : (result?.status ?? 'missing');
    if (now === 'blocking') {
      return [];
    }
    return [
      `prior blocker ${id} (${concernId}) was not verified fixed but is now ${now}${(result?.decision?.reason ?? result?.reason) ? ` (${result?.decision?.reason ?? result.reason})` : ''}; compare the restated facts with the prior review before accepting the change`,
    ];
  });
}

export function sessionStatus(state) {
  const open = obligations(state);
  const tasks = state.order.map((id) => state.tasks[id]);
  const skeptics = tasks.filter((task) => task.role === 'skeptic' && task.status === 'completed');
  const capability = [];
  if (skeptics.some((task) => task.receipt?.agent_id === null)) {
    capability.push('some skeptic verdicts carry no host agent identity, so their independence is not verified');
  }
  const evidence = efficacyRecords(state)
    .filter(({ result }) => result.startsWith('inconclusive_'))
    .map(
      ({ behavior, result, evidence: signature }) =>
        `${behavior}: the reverted test is ${result}, so it does not show that the test detects the regression (${signature})`
    );
  return {
    convergence: priorBlockerChanges(state),
    session_id: state.identity?.session_id,
    revision: state.revision,
    mode: state.identity?.mode,
    round: state.identity?.round,
    head: state.identity?.head_sha,
    prior_fallback: state.identity?.prior.fallback_reason ?? null,
    tasks: Object.fromEntries(
      ['ready', 'completed', 'blocked'].map((status) => [
        status,
        tasks.filter((t) => t.status === status).map((t) => t.id),
      ])
    ),
    complete: open.length === 0,
    obligations: open,
    capability_limits: capability,
    evidence_quality: evidence,
    behavior_change: BEHAVIOR_CLASSES.has(onlyTask(state, 'route')?.result?.change_class),
    finalized: state.finalized
      ? { rendered_ref: state.finalized.rendered_ref, complete: state.finalized.complete }
      : null,
  };
}
