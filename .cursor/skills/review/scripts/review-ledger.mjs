const MODES = ['full', 'incremental'];
const CHANGE_CLASSES = [
  'product-runtime',
  'contracts-and-schemas',
  'infra-build-ci',
  'tests-only',
  'docs-only',
  'mixed',
];
const CHECK_NAMES = ['unit_tests', 'typecheck', 'lint'];
const CHECK_STATUSES = ['pass', 'fail', 'not_applicable'];
const EFFICACY_RESULTS = ['fails_without_fix', 'passes_without_fix', 'no_test_exists'];
const EFFICACY_CLASSES = new Set(['product-runtime', 'contracts-and-schemas', 'mixed']);
const MAX_TEXT = 300;
const LEDGER_FIELDS = new Set([
  'mode',
  'change_class',
  'workers',
  'skeptic_batches',
  'observations',
  'security',
  'checks',
  'efficacy',
  'skipped',
]);

function requiredChecks(changeClass) {
  return changeClass === 'docs-only' ? ['lint'] : CHECK_NAMES;
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

function assertMatched(pair, label, expectedKey, actualKey, remedy) {
  const object = assertObject(pair, label);
  const expected = assertCount(object[expectedKey], `${label}.${expectedKey}`);
  const actual = assertCount(object[actualKey], `${label}.${actualKey}`);
  if (expected !== actual) {
    throw new Error(
      `stage_ledger ${label} is incomplete: ${actual} of ${expected} ${remedy}. Finish the stage, or set the assessment to incomplete`
    );
  }
  return { expected, actual };
}

function readChecks(checks, changeClass) {
  if (!Array.isArray(checks)) {
    throw new Error('stage_ledger checks must be an array');
  }
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
  const missing = requiredChecks(changeClass).filter((name) => !byName.has(name));
  if (missing.length > 0) {
    throw new Error(
      `stage_ledger checks are missing ${missing.join(', ')}. Run each check, or record not_applicable with a reason`
    );
  }
  return [...byName.values()];
}

function readEfficacy(efficacy, mode, changeClass) {
  if (!Array.isArray(efficacy)) {
    throw new Error('stage_ledger efficacy must be an array');
  }
  if (mode === 'full' && EFFICACY_CLASSES.has(changeClass) && efficacy.length === 0) {
    throw new Error(
      'stage_ledger efficacy is empty for a full review of changed behavior. Revert each fix in a disposable worktree and record whether its test fails, or record no_test_exists'
    );
  }
  return efficacy.map((item) => {
    const entry = assertObject(item, 'efficacy entry');
    if (!EFFICACY_RESULTS.includes(entry.result)) {
      throw new Error(`stage_ledger efficacy result must be one of ${EFFICACY_RESULTS.join(', ')}`);
    }
    return {
      behavior: assertText(entry.behavior, 'efficacy behavior'),
      test: entry.result === 'no_test_exists' ? null : assertText(entry.test, 'efficacy test'),
      result: entry.result,
    };
  });
}

function readSkipped(skipped) {
  if (!Array.isArray(skipped)) {
    throw new Error('stage_ledger skipped must be an array');
  }
  return skipped.map((item) => {
    const entry = assertObject(item, 'skipped entry');
    const consent = typeof entry.user_consent === 'string' ? oneLine(entry.user_consent) : '';
    if (consent.length === 0) {
      throw new Error(
        `stage_ledger cannot skip ${String(entry.stage)} without the user's consent. Quote the consent in user_consent, or finish the stage, or set the assessment to incomplete`
      );
    }
    return {
      stage: assertText(entry.stage, 'skipped stage'),
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
  const workers = assertMatched(input.workers, 'workers', 'planned', 'run', 'planned observation workers ran');
  const skeptics = assertMatched(
    input.skeptic_batches,
    'skeptic_batches',
    'required',
    'run',
    'required skeptic batches ran'
  );
  const observations = assertMatched(
    input.observations,
    'observations',
    'total',
    'through_policy',
    'observations went through review-policy.mjs'
  );
  const security = assertObject(input.security, 'security');
  if (typeof security.gate_triggered !== 'boolean' || typeof security.specialist_ran !== 'boolean') {
    throw new Error('stage_ledger security needs boolean gate_triggered and specialist_ran');
  }
  if (security.gate_triggered && !security.specialist_ran) {
    throw new Error(
      'stage_ledger security gate triggered but the security specialist did not run. Run the specialist, or set the assessment to incomplete'
    );
  }
  return {
    mode: input.mode,
    change_class: input.change_class,
    workers,
    skeptics,
    observations,
    security: { gate_triggered: security.gate_triggered, specialist_ran: security.specialist_ran },
    checks: readChecks(input.checks, input.change_class),
    efficacy: readEfficacy(input.efficacy, input.mode, input.change_class),
    skipped: readSkipped(input.skipped),
  };
}

export function renderCoverageLines(ledger) {
  const { mode, workers, skeptics, observations, security, checks, efficacy, skipped } = normalizeStageLedger(ledger);
  const specialist = security.specialist_ran ? 'security specialist ran' : 'security gate not triggered';
  const failing = efficacy.filter(({ result }) => result === 'fails_without_fix').length;
  const lines = [
    `Coverage: ${mode} review · workers ${workers.actual}/${workers.expected} · skeptic batches ${skeptics.actual}/${skeptics.expected} · observations through policy ${observations.actual}/${observations.expected} · ${specialist}`,
    `Checks: ${checks.map(({ name, status }) => `${name} ${status.replace('_', ' ')}`).join(', ')} · revert checks: ${failing} of ${efficacy.length} tests fail without their fix`,
  ];
  if (skipped.length > 0) {
    lines.push(`Skipped with user consent: ${skipped.map(({ stage, reason }) => `${stage} (${reason})`).join('; ')}`);
  }
  return lines;
}
