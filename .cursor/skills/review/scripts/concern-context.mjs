import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function splitTableRow(row) {
  return row
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim());
}

function findTable(markdown, requiredHeaders) {
  const lines = markdown.split('\n');
  const headerIndex = lines.findIndex((line) => {
    if (!line.startsWith('|')) {
      return false;
    }
    const headers = splitTableRow(line).map((header) => header.toLowerCase());
    return requiredHeaders.every((required) => headers.includes(required));
  });
  if (headerIndex === -1) {
    throw new Error(`Table not found: ${requiredHeaders.join(', ')}`);
  }
  const headers = splitTableRow(lines[headerIndex]).map((header) => header.toLowerCase());
  const rows = [];
  for (let index = headerIndex + 2; index < lines.length && lines[index].startsWith('|'); index += 1) {
    const cells = splitTableRow(lines[index]);
    if (cells.length !== headers.length) {
      throw new Error(`Invalid table row at line ${index + 1}`);
    }
    rows.push(Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex]])));
  }
  return rows;
}

function unquote(value) {
  return value.replace(/^`|`$/g, '');
}

function splitList(value, separator = ',') {
  if (!value) {
    return [];
  }
  return value
    .split(separator)
    .map((entry) => unquote(entry.trim()))
    .filter(Boolean);
}

function registryTables(routingMarkdown, detailMarkdown) {
  return {
    routing: findTable(routingMarkdown, ['id', 'trigger_paths', 'trigger_keywords']),
    details: findTable(detailMarkdown, ['id', 'purpose', 'review_questions', 'one_way_doors']),
    anchors: findTable(detailMarkdown, ['concern', 'anchor', 'contract']),
    invariants: findTable(detailMarkdown, ['name', 'concern', 'invariant']),
    candidates: findTable(detailMarkdown, ['concern', 'evidence', 'proposed owner']),
  };
}

export function extractConcernContext({ routingMarkdown, detailMarkdown, concern }) {
  const tables = registryTables(routingMarkdown, detailMarkdown);
  const routing = tables.routing.find((row) => unquote(row.id) === concern);
  const details = tables.details.find((row) => unquote(row.id) === concern);
  if (!routing || !details) {
    throw new Error(`Concern ${concern} is not present in both registries`);
  }
  const anchor = tables.anchors.find((row) => unquote(row.concern) === concern);
  const candidate = tables.candidates.find((row) => unquote(row.concern) === concern);
  const category = { AO: 'always-on', sub: 'subsystem', xcut: 'cross-cutting' }[routing.cat];

  return {
    id: concern,
    category,
    activation: {
      mode: unquote(routing.mode),
      min_signals: Number(routing.min),
      max_context_files: Number(routing.max),
    },
    trigger_paths: splitList(routing.trigger_paths),
    trigger_keywords: splitList(routing.trigger_keywords),
    purpose: details.purpose,
    load_docs: splitList(details.load_docs),
    load_code: splitList(details.load_code),
    review_questions: splitList(details.review_questions, ';'),
    one_way_doors: splitList(details.one_way_doors, ';'),
    verification: splitList(details.verification, ';'),
    related: splitList(details.related),
    contract_anchor: anchor ? { evidence: anchor.anchor, contract: anchor.contract } : null,
    named_invariants: tables.invariants
      .filter((row) => unquote(row.concern) === concern)
      .map((row) => ({ name: unquote(row.name), invariant: row.invariant })),
    pre_contract_candidate: candidate
      ? { evidence: candidate.evidence, proposed_owner: candidate['proposed owner'] }
      : null,
  };
}

export function validateConcernRegistry({ routingMarkdown, detailMarkdown }) {
  const tables = registryTables(routingMarkdown, detailMarkdown);
  const errors = [];
  const routingIds = tables.routing.map((row) => unquote(row.id));
  const detailIds = tables.details.map((row) => unquote(row.id));
  const known = new Set(routingIds);
  const categoryDefaults = {
    AO: { on: 'Y', mode: 'always' },
    sub: { on: 'N', mode: 'strong' },
    xcut: { on: 'N', mode: 'weak' },
  };

  for (const id of new Set(routingIds)) {
    if (routingIds.filter((candidate) => candidate === id).length > 1) {
      errors.push(`Duplicate routing concern: ${id}`);
    }
  }
  for (const id of new Set(detailIds)) {
    if (detailIds.filter((candidate) => candidate === id).length > 1) {
      errors.push(`Duplicate detail concern: ${id}`);
    }
  }
  for (const id of routingIds) {
    if (!detailIds.includes(id)) {
      errors.push(`Missing detail concern: ${id}`);
    }
  }
  for (const id of detailIds) {
    if (!known.has(id)) {
      errors.push(`Missing routing concern: ${id}`);
    }
  }
  for (const row of tables.routing) {
    const id = unquote(row.id);
    const defaults = categoryDefaults[row.cat];
    if (!defaults) {
      errors.push(`Unknown category ${row.cat} for ${id}`);
    } else {
      if (row.on !== defaults.on) {
        errors.push(`on must be ${defaults.on} for ${id}`);
      }
      if (row.mode !== defaults.mode) {
        errors.push(`mode must be ${defaults.mode} for ${id}`);
      }
    }
    const minSignals = Number(row.min);
    if (!Number.isInteger(minSignals) || minSignals < 1 || minSignals > 8) {
      errors.push(`min_signals must be between 1 and 8 for ${id}`);
    }
    const maxContextFiles = Number(row.max);
    if (!Number.isInteger(maxContextFiles) || maxContextFiles < 1 || maxContextFiles > 20) {
      errors.push(`max_context_files must be between 1 and 20 for ${id}`);
    }
    if (splitList(row.trigger_paths).length === 0) {
      errors.push(`trigger_paths must not be empty for ${id}`);
    }
  }
  for (const row of tables.details) {
    const id = unquote(row.id);
    for (const related of splitList(row.related)) {
      if (related !== 'all¹' && !known.has(related)) {
        errors.push(`Unknown related concern ${related} from ${id}`);
      }
    }
  }
  for (const row of [...tables.anchors, ...tables.candidates, ...tables.invariants]) {
    const id = unquote(row.concern);
    if (!known.has(id)) {
      errors.push(`Unknown concern reference: ${id}`);
    }
  }
  return errors;
}

function main() {
  const concern = process.argv[2];
  if (!concern || process.argv.length !== 3) {
    throw new Error('Expected one concern id');
  }
  const routingMarkdown = readFileSync(
    fileURLToPath(new URL('../../../../docs/design/CONCERNS.md', import.meta.url)),
    'utf8'
  );
  const detailMarkdown = readFileSync(
    fileURLToPath(new URL('../../../../docs/design/CONCERN_DETAILS.md', import.meta.url)),
    'utf8'
  );
  process.stdout.write(
    `${JSON.stringify(extractConcernContext({ routingMarkdown, detailMarkdown, concern }), null, 2)}\n`
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
