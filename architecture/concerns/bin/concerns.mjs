#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { computeCoverage } from '../lib/coverage.mjs';
import { ConcernsError, EXIT_FAILED_RESULT, EXIT_OK, EXIT_USAGE, runtimeError, usageError } from '../lib/errors.mjs';
import { changedPathsArgs, splitNulList, trackedFilesArgs, unifiedDiffArgs } from '../lib/git.mjs';
import { analyzeInput, matchConcerns } from '../lib/matching.mjs';
import { ENVELOPE_SCHEMA_VERSION, loadRegistry, REPOSITORY_ROOT, validateRegistry } from '../lib/registry.mjs';
import { normalizeRouteInput, ROUTE_INPUT_DESCRIPTION, routeConcerns } from '../lib/routing.mjs';
import { listConcerns, showConcern } from '../lib/show.mjs';

const FORMATS = ['text', 'json'];
const REGISTRY_DISPLAY_PATH = 'architecture/concerns/registry.json';

function envelope(command, body) {
  const { schema_version: _ignored, ...rest } = body;
  return { schema_version: ENVELOPE_SCHEMA_VERSION, command, ...rest };
}

const COMMANDS = {
  list: {
    summary: 'print every concern id with its category, activation, and purpose',
    usage: 'concerns list [--format text|json]',
    detail: ['Concerns are printed in registry order, which is the published review-routing order.'],
    options: { format: { type: 'string' } },
  },
  show: {
    summary: 'print one concern packet',
    usage: 'concerns show <id> [--worker | --plan | --view routing|review] [--format text|json]',
    detail: [
      'Views are bounded slices of one concern:',
      '  full     everything the registry holds for the concern (the default)',
      '  routing  identity, activation, and typed selectors',
      '  review   purpose, bounded context, questions, doors, verification, contracts',
      '  worker   the bounded packet a review worker receives (--worker)',
      '  plan     the dispatch and budget facts a review planner needs (--plan)',
    ],
    options: {
      format: { type: 'string' },
      view: { type: 'string' },
      worker: { type: 'boolean' },
      plan: { type: 'boolean' },
    },
  },
  match: {
    summary: 'report raw path and semantic evidence for supplied paths and diff text',
    usage: 'concerns match --path <path>... [--text-file <file> | --stdin] [--format text|json]',
    detail: [
      'match reports evidence and never decides activation. Use route for that.',
      'Semantic evidence comes from the changed lines of a unified diff; input that',
      'carries no diff headers is scanned as one block of text and disclosed as such.',
    ],
    options: {
      format: { type: 'string' },
      path: { type: 'string', multiple: true },
      'text-file': { type: 'string' },
      stdin: { type: 'boolean' },
    },
  },
  route: {
    summary: 'decide which concerns a change activates',
    usage: 'concerns route (--base <sha> --head <sha> | --input <file>) [--class <class>] [--format text|json]',
    detail: [
      'route owns signal counting, the semantic-evidence requirement, minimum-signal',
      'thresholds, always-on activation, per-hunk deduplication, and coverage-gap',
      'disclosure. Coverage gaps are disclosed, never used to gate.',
      '',
      '--base and --head must be literal Git SHAs. Git is invoked with literal',
      'argument arrays; no changed path or diff text is ever passed to it.',
      '',
      ROUTE_INPUT_DESCRIPTION,
    ],
    options: {
      format: { type: 'string' },
      base: { type: 'string' },
      head: { type: 'string' },
      input: { type: 'string' },
      class: { type: 'string' },
    },
  },
  validate: {
    summary: 'check the registry against its schema and its cross-record rules',
    usage: 'concerns validate [--registry <path>] [--format text|json]',
    detail: ['Exits 1 when the registry is invalid, so it can be used as a gate.'],
    options: { format: { type: 'string' }, registry: { type: 'string' } },
  },
  coverage: {
    summary: 'report which repository paths conditional concerns claim',
    usage: 'concerns coverage (--tracked | --paths <file> | --path <path>...) [--format text|json]',
    detail: [
      'A path is mapped when a subsystem concern claims it, weakly mapped when only a',
      'cross-cutting concern does, and unmapped otherwise. Always-on concerns cover',
      'every path and so never map one.',
      '',
      'The registry does not yet define its file universe, so coverage describes the',
      'paths it was given. It never asserts that the registry is complete, and it never',
      'changes routing.',
    ],
    options: {
      format: { type: 'string' },
      tracked: { type: 'boolean' },
      paths: { type: 'string' },
      path: { type: 'string', multiple: true },
    },
  },
};

function globalHelp() {
  const width = Math.max(...Object.keys(COMMANDS).map((name) => name.length));
  return [
    'concerns — query the Pathfinder concern registry.',
    '',
    'The registry is the typed record of the concerns PR review routes against: what',
    'each one protects, what activates it, what a reviewer should load, and which',
    'contracts and invariants it owns.',
    '',
    `Registry:  ${REGISTRY_DISPLAY_PATH}`,
    'Schema:    architecture/concerns/registry.schema.json',
    '',
    'Usage: concerns <command> [options]',
    '',
    'Commands:',
    ...Object.entries(COMMANDS).map(([name, spec]) => `  ${name.padEnd(width)}  ${spec.summary}`),
    '',
    'Global options:',
    "  --help, -h     print this message, or a command's help when given after a command",
    '  --version, -v  print the registry format version',
    '  --format       text (default) or json; JSON carries a schema_version envelope',
    '',
    'Semantics:',
    '  Activation is signal counting. A matching changed path is one signal, and a',
    '  semantic hit is one signal per selector per hunk. A conditional concern',
    "  activates when its signals reach its minimum and the registry's semantic",
    '  evidence requirement is satisfied. Always-on concerns always activate, and',
    '  their selectors choose context rather than gate activation.',
    '',
    'Exit codes:',
    '  0  success',
    '  1  the command ran and reported a failing result',
    '  2  usage error',
    '  3  the registry or an external command could not be read',
    '',
    'Output:',
    '  stdout carries only the requested result; diagnostics go to stderr.',
  ].join('\n');
}

function commandHelp(name) {
  const spec = COMMANDS[name];
  return [`concerns ${name} — ${spec.summary}`, '', `Usage: ${spec.usage}`, '', ...spec.detail].join('\n');
}

function resolveFormat(values) {
  const format = values.format ?? 'text';
  if (!FORMATS.includes(format)) {
    throw usageError(`Unknown --format ${format}. Expected one of: ${FORMATS.join(', ')}.`);
  }
  return format;
}

function parse(name, argv) {
  try {
    return parseArgs({
      args: argv,
      strict: true,
      allowPositionals: true,
      options: { ...COMMANDS[name].options, help: { type: 'boolean', short: 'h' } },
    });
  } catch (error) {
    throw usageError(`${error instanceof Error ? error.message : String(error)}\n\n${commandHelp(name)}`);
  }
}

function readTextFile(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    throw runtimeError(`Cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch (error) {
    throw runtimeError(`Cannot read standard input: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function git(args, cwd) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const detail = (error?.stderr ?? '').toString().trim() || (error instanceof Error ? error.message : String(error));
    throw runtimeError(`git ${args[0]} failed: ${detail}`);
  }
}

function emit(format, envelope, text) {
  return format === 'json' ? `${JSON.stringify(envelope, null, 2)}\n` : `${text}\n`;
}

function bullet(label, values) {
  return values.length === 0 ? [] : [`${label}:`, ...values.map((value) => `  - ${value}`)];
}

function listText(payload) {
  const width = Math.max(...payload.concerns.map((concern) => concern.id.length));
  return payload.concerns
    .map(
      (concern) =>
        `${concern.id.padEnd(width)}  ${concern.category.padEnd(13)} ${concern.mode.padEnd(6)} ` +
        `min=${concern.min_signals} max=${concern.max_context_files}  ${concern.purpose}`
    )
    .join('\n');
}

function showText(payload) {
  const concern = payload.concern;
  const lines = [`${concern.id}${concern.name ? ` — ${concern.name}` : ''}`];
  if (concern.category) {
    lines.push(
      `activation: ${concern.activation.kind} (${concern.category}, ${concern.activation.mode}), ` +
        `min_signals=${concern.activation.min_signals}, max_context_files=${concern.activation.max_context_files}`
    );
  }
  if (concern.purpose) {
    lines.push('', `purpose: ${concern.purpose}`);
  }
  lines.push(
    ...bullet('trigger paths', concern.trigger_paths ?? []),
    ...bullet('trigger keywords', concern.trigger_keywords ?? []),
    ...bullet('load docs', concern.load_docs ?? []),
    ...bullet('load code', concern.load_code ?? []),
    ...bullet('review questions', concern.review_questions ?? []),
    ...bullet('one-way doors', concern.one_way_doors ?? []),
    ...bullet('verification', concern.verification ?? [])
  );
  if (concern.related) {
    lines.push(`related: ${concern.related.kind === 'ids' ? concern.related.ids.join(', ') : 'all other concerns'}`);
  }
  if (concern.contract_anchor) {
    lines.push(`contract anchor (${concern.contract_anchor.evidence}): ${concern.contract_anchor.contract}`);
  }
  lines.push(
    ...bullet(
      'named invariants',
      (concern.named_invariants ?? []).map((entry) => `${entry.name}: ${entry.invariant}`)
    )
  );
  if (concern.pre_contract_candidate) {
    lines.push(
      `pre-contract candidate (${concern.pre_contract_candidate.evidence}): ${concern.pre_contract_candidate.proposed_owner}`
    );
  }
  if (payload.view === 'plan') {
    lines.push(
      `specialist: ${concern.specialist ?? 'none'}`,
      `max_context_files: ${concern.max_context_files}`,
      `always_on: ${concern.always_on}`,
      `never_suppressed: ${concern.never_suppressed}`,
      `contract_evolution_eligible: ${concern.contract_evolution_eligible}`
    );
  }
  return lines.join('\n');
}

function matchText(payload) {
  const lines = [
    `paths: ${payload.input.paths.accepted} accepted, ${payload.input.paths.rejected.length} rejected; ` +
      `semantics: ${payload.input.semantics.source}, ${payload.input.semantics.hunk_count} hunk(s)`,
  ];
  if (payload.concerns.length === 0) {
    lines.push('no concern matched the supplied evidence');
  }
  for (const concern of payload.concerns) {
    lines.push(
      `${concern.id}  paths=${concern.distinct_matched_paths.length} semantic_hits=${concern.distinct_semantic_hits}`
    );
    for (const entry of concern.path_evidence) {
      lines.push(`    path ${entry.selector.value} -> ${entry.paths.join(', ')}`);
    }
    for (const entry of concern.semantic_evidence) {
      for (const hit of entry.hits) {
        lines.push(
          `    semantic ${entry.selector.value} -> ${hit.path ?? '<no file>'} hunk ${hit.hunk} x${hit.occurrences}`
        );
      }
    }
  }
  return [...lines, ...payload.input.disclosures.map((entry) => `disclosure [${entry.kind}] ${entry.message}`)].join(
    '\n'
  );
}

function routeText(payload) {
  const lines = [
    `change class: ${payload.change_class.value} (${payload.change_class.source})`,
    `input: ${payload.input.paths.accepted} path(s), ${payload.input.semantics.hunk_count} hunk(s) from ${payload.input.semantics.source}`,
    '',
    'activated:',
    ...payload.activated.map(
      (entry) =>
        `  ${entry.id} [${entry.reason}] signals ${entry.signals.total}/${entry.signals.minimum_required} ` +
        `(path ${entry.signals.path}, semantic ${entry.signals.semantic})${entry.specialist ? ` specialist=${entry.specialist}` : ''}`
    ),
  ];
  if (payload.withheld.length > 0) {
    lines.push(
      '',
      'withheld:',
      ...payload.withheld.map(
        (entry) => `  ${entry.id} [${entry.reason}] signals ${entry.signals.total}/${entry.signals.minimum_required}`
      )
    );
  }
  if (payload.considered.length > 0) {
    lines.push(
      '',
      'considered:',
      ...payload.considered.map(
        (entry) => `  ${entry.id} [${entry.reason}] signals ${entry.signals.total}/${entry.signals.minimum_required}`
      )
    );
  }
  lines.push(
    '',
    `coverage gaps (${payload.policy.coverage_gap_disposition}, gate=${payload.policy.coverage_gap_is_gate}):`,
    ...(payload.coverage_gaps.length === 0
      ? ['  none']
      : payload.coverage_gaps.map((gap) => `  ${gap.kind} ${gap.directory ?? gap.detail ?? ''}`.trimEnd())),
    '',
    'disclosures:',
    ...payload.disclosures.map((entry) => `  [${entry.kind}] ${entry.message}`)
  );
  return lines.join('\n');
}

function validateText(payload) {
  if (payload.valid) {
    return `${payload.registry_path}: valid (${payload.counts.concerns} concerns, ${payload.counts.discrepancies} recorded discrepancies)`;
  }
  return [
    `${payload.registry_path}: invalid`,
    ...payload.schema_errors.map((error) => `  schema ${error.path}: ${error.message}`),
    ...payload.semantic_errors.map((error) => `  semantic ${error.path}: ${error.message}`),
  ].join('\n');
}

function coverageText(payload) {
  return [
    `paths: ${payload.counts.total} (${payload.counts.mapped} mapped, ${payload.counts.weakly_mapped} weakly mapped, ` +
      `${payload.counts.unmapped} unmapped, ${payload.counts.rejected} rejected)`,
    'unmapped clusters:',
    ...(payload.unmapped_clusters.length === 0
      ? ['  none']
      : payload.unmapped_clusters.map((cluster) => `  ${cluster.directory}  ${cluster.count}`)),
    `file universe: ${payload.policy.file_universe_status} — coverage describes the supplied paths and asserts no registry completeness`,
  ].join('\n');
}

// Read commands (list/show/match/route/coverage) load the registry without
// re-validating it. Schema and semantic conformance is a build-time property,
// checked once by `concerns validate` (run in CI on every registry change),
// not a per-invocation cost every reader should pay again. Re-validating here
// bought no reader any safety CI had not already given them, and it was most
// of this CLI's wall-clock cost: it pulls in the JSON-Schema validator and
// re-runs the full schema-plus-semantic pass on every call, even a single
// `show`. A malformed (unreadable or unparseable) registry.json still fails
// loudly via `loadRegistry`; only the "well-formed but non-conformant" case
// stops being caught outside `validate` itself.
function semanticText(values) {
  if (values['text-file'] !== undefined && values.stdin) {
    throw usageError('Give either --text-file or --stdin, not both.');
  }
  if (values['text-file'] !== undefined) {
    return readTextFile(values['text-file']);
  }
  return values.stdin ? readStdin() : null;
}

function runList(argv) {
  const { values } = parse('list', argv);
  if (values.help) {
    return { text: commandHelp('list'), code: EXIT_OK };
  }
  const format = resolveFormat(values);
  const { registry } = loadRegistry();
  const payload = envelope('list', listConcerns({ registry }));
  return { text: emit(format, payload, listText(payload)), code: EXIT_OK };
}

function runShow(argv) {
  const { values, positionals } = parse('show', argv);
  if (values.help) {
    return { text: commandHelp('show'), code: EXIT_OK };
  }
  const format = resolveFormat(values);
  if (positionals.length !== 1) {
    throw usageError(`Expected exactly one concern id.\n\n${commandHelp('show')}`);
  }
  const selected = [values.worker ? 'worker' : null, values.plan ? 'plan' : null, values.view ?? null].filter(Boolean);
  if (selected.length > 1) {
    throw usageError('Give at most one of --worker, --plan, or --view.');
  }
  const { registry } = loadRegistry();
  const payload = envelope('show', showConcern({ registry, id: positionals[0], view: selected[0] ?? 'full' }));
  return { text: emit(format, payload, showText(payload)), code: EXIT_OK };
}

function runMatch(argv) {
  const { values } = parse('match', argv);
  if (values.help) {
    return { text: commandHelp('match'), code: EXIT_OK };
  }
  const format = resolveFormat(values);
  const text = semanticText(values);
  const paths = values.path ?? [];
  if (paths.length === 0 && text === null) {
    throw usageError(
      `Give at least one --path, or supply diff text with --text-file or --stdin.\n\n${commandHelp('match')}`
    );
  }
  const { registry } = loadRegistry();
  const payload = envelope('match', matchConcerns({ registry, input: analyzeInput({ paths, text }) }));
  return { text: emit(format, payload, matchText(payload)), code: EXIT_OK };
}

function runRoute(argv) {
  const { values } = parse('route', argv);
  if (values.help) {
    return { text: commandHelp('route'), code: EXIT_OK };
  }
  const format = resolveFormat(values);
  const fromGit = values.base !== undefined || values.head !== undefined;
  if (fromGit === (values.input !== undefined)) {
    throw usageError(`Give either --base with --head, or --input.\n\n${commandHelp('route')}`);
  }

  let request;
  if (fromGit) {
    if (values.base === undefined || values.head === undefined) {
      throw usageError('--base and --head must be given together.');
    }
    const paths = splitNulList(git(changedPathsArgs(values.base, values.head)));
    request = { paths, text: git(unifiedDiffArgs(values.base, values.head)), changeClass: values.class ?? null };
  } else {
    let raw;
    try {
      raw = JSON.parse(readTextFile(values.input));
    } catch (error) {
      if (error instanceof ConcernsError) {
        throw error;
      }
      throw usageError(`${values.input} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    const normalized = normalizeRouteInput(raw);
    request = { ...normalized, changeClass: values.class ?? normalized.changeClass };
  }

  const { registry } = loadRegistry();
  const input = analyzeInput({ paths: request.paths, text: request.text });
  const payload = envelope('route', routeConcerns({ registry, input, changeClass: request.changeClass }));
  return { text: emit(format, payload, routeText(payload)), code: EXIT_OK };
}

function runValidate(argv) {
  const { values } = parse('validate', argv);
  if (values.help) {
    return { text: commandHelp('validate'), code: EXIT_OK };
  }
  const format = resolveFormat(values);
  const loaded = loadRegistry(values.registry ? { registryPath: values.registry } : {});
  const result = validateRegistry(loaded);
  const payload = {
    schema_version: ENVELOPE_SCHEMA_VERSION,
    command: 'validate',
    registry_path: relative(REPOSITORY_ROOT, loaded.registryPath),
    valid: result.valid,
    schema_errors: result.schema_errors,
    semantic_errors: result.semantic_errors,
    counts: {
      concerns: Array.isArray(loaded.registry.concerns) ? loaded.registry.concerns.length : 0,
      discrepancies: Array.isArray(loaded.registry.migration_discrepancies)
        ? loaded.registry.migration_discrepancies.length
        : 0,
    },
  };
  return { text: emit(format, payload, validateText(payload)), code: result.valid ? EXIT_OK : EXIT_FAILED_RESULT };
}

function runCoverage(argv) {
  const { values } = parse('coverage', argv);
  if (values.help) {
    return { text: commandHelp('coverage'), code: EXIT_OK };
  }
  const format = resolveFormat(values);
  const sources = [
    values.tracked ? 'tracked' : null,
    values.paths !== undefined ? 'paths-file' : null,
    (values.path ?? []).length > 0 ? 'arguments' : null,
  ].filter(Boolean);
  if (sources.length !== 1) {
    throw usageError(`Give exactly one of --tracked, --paths, or --path.\n\n${commandHelp('coverage')}`);
  }
  let paths;
  if (values.tracked) {
    paths = splitNulList(git(trackedFilesArgs(), REPOSITORY_ROOT));
  } else if (values.paths !== undefined) {
    paths = readTextFile(values.paths)
      .split('\n')
      .map((line) => line.replace(/\r$/, ''))
      .filter((line) => line.length > 0);
  } else {
    paths = values.path;
  }
  const { registry } = loadRegistry();
  const payload = { ...envelope('coverage', computeCoverage({ registry, paths })), source: sources[0] };
  return { text: emit(format, payload, coverageText(payload)), code: EXIT_OK };
}

const RUNNERS = {
  list: runList,
  show: runShow,
  match: runMatch,
  route: runRoute,
  validate: runValidate,
  coverage: runCoverage,
};

export function run(argv) {
  const [command, ...rest] = argv;
  if (command === undefined || command === '--help' || command === '-h') {
    return { text: `${globalHelp()}\n`, code: EXIT_OK };
  }
  if (command === '--version' || command === '-v') {
    let values;
    try {
      values = parseArgs({
        args: rest,
        strict: true,
        allowPositionals: false,
        options: { format: { type: 'string' } },
      }).values;
    } catch (error) {
      throw usageError(error instanceof Error ? error.message : String(error));
    }
    const format = resolveFormat(values);
    const { registry } = loadRegistry();
    const payload = {
      schema_version: ENVELOPE_SCHEMA_VERSION,
      command: 'version',
      registry_format_version: registry.schema_version,
      registry_id: registry.registry.id,
    };
    return { text: emit(format, payload, `registry format version ${registry.schema_version}`), code: EXIT_OK };
  }
  const runner = RUNNERS[command];
  if (!runner) {
    throw usageError(`Unknown command ${command}.\n\n${globalHelp()}`);
  }
  return runner(rest);
}

function main() {
  try {
    const { text, code } = run(process.argv.slice(2));
    process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
    process.exitCode = code;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = error instanceof ConcernsError ? error.exitCode : EXIT_USAGE;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
