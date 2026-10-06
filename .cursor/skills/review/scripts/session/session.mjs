#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { materializeTask } from './briefs.mjs';
import { advance, buildIdentity, recordBlocked, recordResult, recordWaiver } from './controller.mjs';
import { executeCommandTask } from './evidence.mjs';
import { renderSession, sessionStatus } from './finalize.mjs';
import { assertSharedInputsUnchanged, loadRegistry, realEffects, sharedInputHashes, toolRevision } from './inputs.mjs';
import { applyEvent, sealEvents } from './model.mjs';
import { createSessionDir, loadSession, storeArtifact, withSession } from './store.mjs';

const SCRIPT = fileURLToPath(import.meta.url);
const OPTIONS = {
  repo: { type: 'string' },
  pr: { type: 'string' },
  base: { type: 'string' },
  head: { type: 'string' },
  reviewer: { type: 'string' },
  title: { type: 'string' },
  'intent-file': { type: 'string' },
  'repo-dir': { type: 'string' },
  'sessions-dir': { type: 'string' },
  'prior-review': { type: 'string' },
  'prior-review-author': { type: 'string' },
  'prior-review-count': { type: 'string' },
  session: { type: 'string' },
  task: { type: 'string' },
  result: { type: 'string' },
  blocked: { type: 'string' },
  'agent-id': { type: 'string' },
  'no-agent-identity': { type: 'boolean' },
  host: { type: 'string' },
  revise: { type: 'string' },
  'all-ready': { type: 'boolean' },
  stage: { type: 'string' },
  reason: { type: 'string' },
  consent: { type: 'string' },
};

function absolute(value, label) {
  if (!value || !isAbsolute(value)) {
    throw new Error(`${label} must be an absolute path`);
  }
  return resolve(value);
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function contextFor(state) {
  return { effects: realEffects(state.identity.repo_dir), registry: loadRegistry() };
}

function readyView(state, sessionDir, ctx) {
  const ready = state.order.map((id) => state.tasks[id]).filter((task) => task.status === 'ready');
  return ready.map((task) => {
    if (task.role === 'command') {
      return {
        task_id: task.id,
        role: task.role,
        executor: 'controller',
        stage: task.stage,
        kind: task.spec.kind,
        argv: task.spec.argv,
        run: `node ${SCRIPT} exec --session ${sessionDir} --task ${task.id}`,
      };
    }
    const paths = materializeTask(state, task, sessionDir, ctx);
    const identityFlag = task.executor === 'agent' ? ' --agent-id <host agent id>' : '';
    return {
      task_id: task.id,
      role: task.role,
      executor: task.executor,
      stage: task.stage,
      concern_ids: task.concern_ids,
      ...(task.role === 'skeptic'
        ? { verification_role: task.spec.verification_role, independent_role: task.spec.independent_role }
        : {}),
      brief: paths.brief,
      result: paths.result,
      record: `node ${SCRIPT} record --session ${sessionDir} --task ${task.id} --head ${task.head} --result ${paths.result}${identityFlag}`,
    };
  });
}

function view(state, sessionDir) {
  const status = sessionStatus(state);
  const ctx = state.identity ? contextFor(state) : null;
  return {
    session_dir: sessionDir,
    ...status,
    ready: ctx ? readyView(state, sessionDir, ctx) : [],
    next_step:
      status.tasks.ready.length > 0
        ? 'dispatch every ready task, record each result, then run next again'
        : `run: node ${SCRIPT} finalize --session ${sessionDir}`,
  };
}

function mutate(sessionDir, build) {
  const { state, output } = withSession(sessionDir, (current) => {
    assertSharedInputsUnchanged(current.identity);
    if (current.finalized?.complete) {
      throw new Error('this session is finalized as a complete review; start a new session for further work');
    }
    const drafts = build(current) ?? [];
    let working = current;
    const sealed = sealEvents(working, drafts);
    for (const event of sealed) {
      working = applyEvent(working, event);
    }
    const derived = advance(working, contextFor(working));
    return { events: [...sealed, ...derived], output: null };
  });
  return { state, output };
}

function readIntent(path) {
  if (path === undefined) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(absolute(path, '--intent-file'), 'utf8'));
  } catch (error) {
    throw new Error(`--intent-file must be a JSON file with the PR title and body: ${error.message}`);
  }
}

function start(values) {
  const repoDir = absolute(values['repo-dir'], '--repo-dir');
  const sessionsDir = absolute(values['sessions-dir'], '--sessions-dir');
  const head = values.head ?? '';
  const actual = git(repoDir, ['rev-parse', 'HEAD']);
  if (actual !== head) {
    throw new Error(`--repo-dir is at ${actual}; check out the PR head ${head} there before starting`);
  }
  const effects = realEffects(repoDir);
  if (!effects.isAncestor(values.base ?? '', head)) {
    throw new Error('--base must be an ancestor of --head (use the merge base with the target branch)');
  }
  const priorPath = values['prior-review'];
  const intent = readIntent(values['intent-file']);
  if (intent && values.title !== undefined && values.title !== intent.title) {
    throw new Error('--title and the intent file title differ; pass one PR title');
  }
  const identity = buildIdentity(
    {
      repo: values.repo,
      pr: Number(values.pr),
      pr_title: values.title ?? intent?.title,
      intent,
      base_sha: values.base,
      head_sha: head,
      reviewer: values.reviewer,
      repo_dir: repoDir,
      prior: {
        body: priorPath ? readFileSync(absolute(priorPath, '--prior-review'), 'utf8') : null,
        author: values['prior-review-author'] ?? null,
        count: values['prior-review-count'] === undefined ? 0 : Number(values['prior-review-count']),
      },
    },
    { effects, sharedInputs: sharedInputHashes(), tool: toolRevision() }
  );
  const sessionDir = join(sessionsDir, identity.session_id);
  if (existsSync(join(sessionDir, 'events.jsonl'))) {
    const existing = loadSession(sessionDir);
    if (existing.identity?.session_id === identity.session_id) {
      return mutate(sessionDir, () => []).state;
    }
  }
  createSessionDir(sessionDir);
  if (identity.prior.body_ref) {
    const saved = storeArtifact(sessionDir, readFileSync(absolute(priorPath, '--prior-review'), 'utf8'), 'md');
    if (saved.ref !== identity.prior.body_ref) {
      throw new Error('the prior review changed while the session started; start again');
    }
  }
  return withSession(sessionDir, (current) => {
    const [started] = sealEvents(current, [{ type: 'session_started', data: { identity } }]);
    const working = applyEvent(current, started);
    return { events: [started, ...advance(working, contextFor(working))] };
  }).state;
}

function receiptFrom(values) {
  return {
    host: values.host ?? 'unspecified',
    agent_id: values['agent-id'] ?? null,
    host_capability: values['no-agent-identity'] ? 'no_agent_identity' : null,
  };
}

function record(sessionDir, values) {
  let output = null;
  const { state } = mutate(sessionDir, (current) => {
    if (values.blocked !== undefined) {
      output = { task_id: values.task, status: 'blocked' };
      return [
        recordBlocked(current, {
          task_id: values.task,
          head: values.head,
          reason: values.blocked,
          receipt: receiptFrom(values),
        }),
      ];
    }
    const result = JSON.parse(readFileSync(absolute(values.result, '--result'), 'utf8'));
    const outcome = recordResult(current, {
      task_id: values.task,
      head: values.head,
      result,
      receipt: receiptFrom(values),
      revise_reason: values.revise,
    });
    output = outcome.output;
    return outcome.draft ? [outcome.draft] : [];
  });
  return { recorded: output, ...view(state, sessionDir) };
}

function exec(sessionDir, values) {
  const ran = [];
  for (;;) {
    const state = loadSession(sessionDir);
    const ready = state.order
      .map((id) => state.tasks[id])
      .filter(
        (task) => task.role === 'command' && task.status === 'ready' && (values['all-ready'] || task.id === values.task)
      );
    if (ready.length === 0) {
      if (ran.length === 0) {
        throw new Error(values['all-ready'] ? 'no command task is ready' : `command task ${values.task} is not ready`);
      }
      return { executed: ran, ...view(loadSession(sessionDir), sessionDir) };
    }
    const [task] = ready;
    assertSharedInputsUnchanged(state.identity);
    const evidence = executeCommandTask({
      task,
      identity: state.identity,
      sessionDir,
      store: (content) => storeArtifact(sessionDir, content),
      readArtifact: (ref) => readFileSync(join(sessionDir, ref), 'utf8'),
      headEvidence: task.spec.kind === 'baseline' ? state.tasks[task.spec.head_command].result : null,
    });
    mutate(sessionDir, (current) => {
      if (current.tasks[task.id].status !== 'ready') {
        throw new Error(`command task ${task.id} was recorded by another writer while it ran`);
      }
      return [
        {
          type: 'task_completed',
          data: {
            task_id: task.id,
            result: evidence,
            result_hash: null,
            receipt: { host: 'controller', agent_id: null, provenance: 'controller_observed' },
          },
        },
      ];
    });
    ran.push({ task_id: task.id, exit_status: evidence.exit_status ?? null, error: evidence.error ?? null });
    if (!values['all-ready']) {
      return { executed: ran, ...view(loadSession(sessionDir), sessionDir) };
    }
  }
}

function finalize(sessionDir) {
  const existing = loadSession(sessionDir);
  if (existing.finalized?.complete) {
    return { complete: true, obligations: [], rendered_path: join(sessionDir, 'review.md'), already_finalized: true };
  }
  let summary = null;
  mutate(sessionDir, (current) => {
    const { rendered, open, report } = renderSession(current);
    const artifact = storeArtifact(sessionDir, `${rendered}\n`, 'md');
    writeFileSync(join(sessionDir, 'review.md'), `${rendered}\n`);
    writeFileSync(join(sessionDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    summary = { complete: open.length === 0, obligations: open, rendered_path: join(sessionDir, 'review.md') };
    if (current.finalized?.rendered_sha256 === artifact.sha256) {
      return [];
    }
    return [
      {
        type: 'finalized',
        data: {
          complete: open.length === 0,
          rendered_ref: artifact.ref,
          rendered_sha256: artifact.sha256,
          at_revision: current.revision,
        },
      },
    ];
  });
  return summary;
}

function sessionArg(values) {
  const dir = absolute(values.session, '--session');
  if (!existsSync(join(dir, 'events.jsonl'))) {
    throw new Error(`${dir} is not a review session directory`);
  }
  return dir;
}

export function main(argv) {
  const [command, ...rest] = argv;
  const { values } = parseArgs({ args: rest, options: OPTIONS, strict: true, allowPositionals: false });
  switch (command) {
    case 'start': {
      const state = start(values);
      return view(state, join(absolute(values['sessions-dir'], '--sessions-dir'), state.identity.session_id));
    }
    case 'next':
    case 'status': {
      const dir = sessionArg(values);
      const state = loadSession(dir);
      return command === 'next' ? view(state, dir) : { session_dir: dir, ...sessionStatus(state) };
    }
    case 'record':
      return record(sessionArg(values), values);
    case 'exec':
      return exec(sessionArg(values), values);
    case 'waive': {
      const dir = sessionArg(values);
      const { state } = mutate(dir, (current) => [
        recordWaiver(current, { stage: values.stage, reason: values.reason, user_consent: values.consent }),
      ]);
      return view(state, dir);
    }
    case 'finalize':
      return finalize(sessionArg(values));
    default:
      throw new Error('Expected one of: start, next, record, exec, waive, status, finalize');
  }
}

if (process.argv[1] === SCRIPT) {
  try {
    process.stdout.write(`${JSON.stringify(main(process.argv.slice(2)), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
