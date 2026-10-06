const MODES = ['full', 'incremental'];
const CHANGE_CLASSES = [
  'product-runtime',
  'contracts-and-schemas',
  'infra-build-ci',
  'tests-only',
  'docs-only',
  'mixed',
];
const GO_CHECKS = ['go_build', 'go_lint', 'go_test'];
const CHECK_NAMES = ['unit_tests', 'typecheck', 'lint', ...GO_CHECKS];
const CHECK_STATUSES = ['pass', 'fail', 'not_applicable'];
const EFFICACY_RESULTS = [
  'fails_on_behavior',
  'inconclusive_setup',
  'inconclusive_error',
  'passes_without_fix',
  'no_test_exists',
];
const NEEDS_DISPOSITION = new Set(['passes_without_fix', 'no_test_exists']);
const BEHAVIOR_CLASSES = new Set(['product-runtime', 'contracts-and-schemas', 'mixed']);
const SKIP_STAGES = [
  'workers',
  'skeptic_batches',
  'observations',
  'security_specialist',
  'unit_tests',
  'typecheck',
  'lint',
  ...GO_CHECKS,
  'test_efficacy',
];
const MAX_TEXT = 300;
const LEDGER_FIELDS = new Set([
  'mode',
  'change_class',
  'surfaces',
  'workers',
  'skeptic_batches',
  'observations',
  'security',
  'checks',
  'efficacy',
  'skipped',
]);

function requiredChecks(changeClass, surfaces) {
  const base = changeClass === 'docs-only' ? ['lint'] : ['unit_tests', 'typecheck', 'lint'];
  return surfaces.go ? [...base, ...GO_CHECKS] : base;
}

function oneLine(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function assertText(value, label) {
  const text = typeof value === 'string' ? oneLine(value) : '';
  if (text.length === 0 || text.length > MAX_TEXT) {
    throw new Error(`stage_ledger ${label} must be one line of at most ${MAX_TEXT} characters`);
  }
  if (text.includes('<!--') || text.includes('-->') || text.includes('pathfinder-review-state')) {
    throw new Error(`stage_ledger ${label} must not embed an HTML comment boundary or a review state marker`);
  }
  return text;
}

function assertCount(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`stage_ledger ${label} must be a non-negative integer`);
  }
  return value;
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`stage_ledger ${label} must be an object`);
  }
  return value;
}

function assertMatched(pair, label, expectedKey, actualKey, remedy, waived) {
  const object = assertObject(pair, label);
  const expected = assertCount(object[expectedKey], `${label}.${expectedKey}`);
  const actual = assertCount(object[actualKey], `${label}.${actualKey}`);
  if (expected !== actual && !(waived && actual < expected)) {
    throw new Error(
      `stage_ledger ${label} is incomplete: ${actual} of ${expected} ${remedy}. Finish the stage, or set the assessment to incomplete`
    );
  }
  return { expected, actual };
}

function readSurfaces(value) {
  const surfaces = assertObject(value, 'surfaces');
  const unknown = Object.keys(surfaces).find((field) => field !== 'go');
  if (unknown) {
    throw new Error(`unknown stage_ledger surfaces field: ${unknown}`);
  }
  if (typeof surfaces.go !== 'boolean') {
    throw new Error('stage_ledger surfaces.go must be the boolean go value from changed-surface.mjs');
  }
  return { go: surfaces.go };
}

function readChecks(checks, changeClass, surfaces, waived) {
  if (!Array.isArray(checks)) {
    throw new Error('stage_ledger checks must be an array');
  }
  const required = requiredChecks(changeClass, surfaces);
  const byName = new Map();
  for (const check of checks) {
    const entry = assertObject(check, 'check');
    if (!CHECK_NAMES.includes(entry.name)) {
      throw new Error(`stage_ledger check name must be one of ${CHECK_NAMES.join(', ')}`);
    }
    if (byName.has(entry.name)) {
      throw new Error(`stage_ledger check ${entry.name} must appear once`);
    }
    if (!CHECK_STATUSES.includes(entry.status)) {
      throw new Error(`stage_ledger check ${entry.name} status must be pass, fail, or not_applicable`);
    }
    if (entry.status === 'not_applicable') {
      if (surfaces.go && GO_CHECKS.includes(entry.name)) {
        throw new Error(
          `stage_ledger check ${entry.name} cannot be not_applicable when Go changed. Run it, or quote the user's consent in a skipped entry for ${entry.name}`
        );
      }
      if (BEHAVIOR_CLASSES.has(changeClass) && required.includes(entry.name) && !waived.has(entry.name)) {
        throw new Error(
          `stage_ledger check ${entry.name} cannot be not_applicable for a ${changeClass} change without the user's consent. Run the check, or quote the consent in a skipped entry for ${entry.name}`
        );
      }
      byName.set(entry.name, {
        name: entry.name,
        status: entry.status,
        reason: assertText(entry.reason, `check ${entry.name} reason`),
      });
    } else {
      byName.set(entry.name, {
        name: entry.name,
        status: entry.status,
        command: assertText(entry.command, `check ${entry.name} command`),
      });
    }
  }
  const missing = required.filter((name) => !byName.has(name));
  const unwaived = missing.filter((name) => !waived.has(name));
  if (unwaived.length > 0) {
    throw new Error(
      `stage_ledger checks are missing ${unwaived.join(', ')}. Run each check, or quote the user's consent in a skipped entry`
    );
  }
  return [...byName.values(), ...missing.map((name) => ({ name, status: 'skipped' }))];
}

function readEfficacy(efficacy, mode, changeClass, waived) {
  if (!Array.isArray(efficacy)) {
    throw new Error('stage_ledger efficacy must be an array');
  }
  if (mode === 'full' && BEHAVIOR_CLASSES.has(changeClass) && efficacy.length === 0 && !waived) {
    throw new Error(
      'stage_ledger efficacy is empty for a full review of changed behavior. Revert each fix in a disposable worktree and record how its test fails, or record no_test_exists'
    );
  }
  return efficacy.map((item) => {
    const entry = assertObject(item, 'efficacy entry');
    if (entry.result === 'fails_without_fix') {
      throw new Error(
        'stage_ledger efficacy result fails_without_fix is retired. Classify the reverted run from its output: fails_on_behavior (an assertion failed), inconclusive_setup (setup, import, module-resolution, or compile failure), or inconclusive_error (the test errored without an assertion failure)'
      );
    }
    if (!EFFICACY_RESULTS.includes(entry.result)) {
      throw new Error(`stage_ledger efficacy result must be one of ${EFFICACY_RESULTS.join(', ')}`);
    }
    const tested = entry.result !== 'no_test_exists';
    return {
      behavior: assertText(entry.behavior, 'efficacy behavior'),
      test: tested ? assertText(entry.test, 'efficacy test') : null,
      result: entry.result,
      evidence: tested ? assertText(entry.evidence, `efficacy ${entry.result} evidence`) : null,
      disposition_note: NEEDS_DISPOSITION.has(entry.result)
        ? assertText(entry.disposition_note, `efficacy ${entry.result} disposition_note`)
        : null,
    };
  });
}

function readSkipped(skipped) {
  if (!Array.isArray(skipped)) {
    throw new Error('stage_ledger skipped must be an array');
  }
  const seen = new Set();
  return skipped.map((item) => {
    const entry = assertObject(item, 'skipped entry');
    if (!SKIP_STAGES.includes(entry.stage)) {
      throw new Error(`stage_ledger skipped stage must be one of ${SKIP_STAGES.join(', ')}`);
    }
    if (seen.has(entry.stage)) {
      throw new Error(`stage_ledger skipped stage ${entry.stage} must appear once`);
    }
    seen.add(entry.stage);
    const consent = typeof entry.user_consent === 'string' ? oneLine(entry.user_consent) : '';
    if (consent.length === 0) {
      throw new Error(
        `stage_ledger cannot skip ${String(entry.stage)} without the user's consent. Quote the consent in user_consent, or finish the stage, or set the assessment to incomplete`
      );
    }
    return {
      stage: entry.stage,
      reason: assertText(entry.reason, 'skipped reason'),
      user_consent: assertText(consent, 'skipped user_consent'),
    };
  });
}

export function normalizeStageLedger(ledger) {
  if (ledger === undefined || ledger === null) {
    throw new Error(
      'stage_ledger is required for a complete review. If required review work could not run, set the assessment to incomplete with one reason'
    );
  }
  const input = assertObject(ledger, 'ledger');
  const unknown = Object.keys(input).find((field) => !LEDGER_FIELDS.has(field));
  if (unknown) {
    throw new Error(`unknown stage_ledger field: ${unknown}`);
  }
  if (!MODES.includes(input.mode)) {
    throw new Error('stage_ledger mode must be full or incremental');
  }
  if (!CHANGE_CLASSES.includes(input.change_class)) {
    throw new Error(`stage_ledger change_class must be one of ${CHANGE_CLASSES.join(', ')}`);
  }
  const surfaces = readSurfaces(input.surfaces);
  const skipped = readSkipped(input.skipped);
  const waived = new Set(skipped.map(({ stage }) => stage));
  const workers = assertMatched(
    input.workers,
    'workers',
    'planned',
    'run',
    'planned observation workers ran',
    waived.has('workers')
  );
  const skeptics = assertMatched(
    input.skeptic_batches,
    'skeptic_batches',
    'required',
    'run',
    'required skeptic batches ran',
    waived.has('skeptic_batches')
  );
  const observations = assertMatched(
    input.observations,
    'observations',
    'total',
    'through_policy',
    'observations went through review-policy.mjs',
    waived.has('observations')
  );
  const security = assertObject(input.security, 'security');
  if (typeof security.gate_triggered !== 'boolean' || typeof security.specialist_ran !== 'boolean') {
    throw new Error('stage_ledger security needs boolean gate_triggered and specialist_ran');
  }
  if (security.gate_triggered && !security.specialist_ran && !waived.has('security_specialist')) {
    throw new Error(
      'stage_ledger security gate triggered but the security specialist did not run. Run the specialist, or set the assessment to incomplete'
    );
  }
  return {
    mode: input.mode,
    change_class: input.change_class,
    surfaces,
    workers,
    skeptics,
    observations,
    security: { gate_triggered: security.gate_triggered, specialist_ran: security.specialist_ran },
    checks: readChecks(input.checks, input.change_class, surfaces, waived),
    efficacy: readEfficacy(input.efficacy, input.mode, input.change_class, waived.has('test_efficacy')),
    skipped,
  };
}

export function renderCoverageLines(ledger) {
  const { mode, workers, skeptics, observations, security, checks, efficacy, skipped } = normalizeStageLedger(ledger);
  const specialist = security.specialist_ran
    ? 'security specialist ran'
    : security.gate_triggered
      ? 'security specialist skipped'
      : 'security gate not triggered';
  const count = (result) => efficacy.filter((entry) => entry.result === result).length;
  const revert = [
    `revert checks: ${count('fails_on_behavior')} of ${efficacy.length} fail on behavior`,
    `${count('inconclusive_setup')} inconclusive (setup)`,
    `${count('inconclusive_error')} inconclusive (error)`,
    `${count('passes_without_fix')} pass without fix`,
    `${count('no_test_exists')} no test`,
  ].join(' · ');
  const lines = [
    `Coverage: ${mode} review · workers ${workers.actual}/${workers.expected} · skeptic batches ${skeptics.actual}/${skeptics.expected} · observations through policy ${observations.actual}/${observations.expected} · ${specialist}`,
    `Checks: ${checks.map(({ name, status }) => `${name} ${status.replace('_', ' ')}`).join(', ')} · ${revert}`,
  ];
  if (skipped.length > 0) {
    lines.push(`Skipped with user consent: ${skipped.map(({ stage, reason }) => `${stage} (${reason})`).join('; ')}`);
  }
  return lines;
}
