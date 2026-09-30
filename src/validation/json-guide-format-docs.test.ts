import * as fs from 'fs';
import * as path from 'path';

import { GUIDED_ACTION_TYPES } from '../types/interactive-actions.types';
import { JsonBlockSchema, JsonInteractiveActionSchema } from '../types/json-guide.schema';

const DOC_RELATIVE_PATH = 'docs/developer/interactive-examples/json-guide-format.md';
const DOC_PATH = path.resolve(__dirname, '../..', DOC_RELATIVE_PATH);
const SUMMARY_HEADING = '### Block Types Summary';
const GUIDED_ACTIONS_HEADING = '#### Actions a guided step accepts';

/** Bump deliberately: a short count means the union shrank or Zod's internals moved. */
const EXPECTED_BLOCK_TYPE_COUNT = 21;

function unwrap(schema: any): any {
  const inner = schema?._zod?.def?.innerType;
  return inner ? unwrap(inner) : schema;
}

function collectBlockTypes(schema: any, out: Set<string>): void {
  const def = unwrap(schema)?._zod?.def;
  if (!def) {
    return;
  }
  if (def.type === 'union') {
    for (const option of def.options) {
      collectBlockTypes(option, out);
    }
    return;
  }
  if (def.type === 'object') {
    const discriminator = unwrap(def.shape?.type)?._zod?.def?.values;
    if (discriminator) {
      out.add([...discriminator][0]);
    }
  }
}

function blockTypesFromSchema(): string[] {
  const types = new Set<string>();
  collectBlockTypes(JsonBlockSchema, types);
  return [...types].sort();
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Scope rows to their section because other tables reuse action and block names.
function tableSection(markdown: string, heading: string): string {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) {
    return '';
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('#') || line.trim() === '---');
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

const blockTypes = blockTypesFromSchema();
const doc = fs.readFileSync(DOC_PATH, 'utf-8');
const summaryTable = tableSection(doc, SUMMARY_HEADING);
const guidedActionRows = tableSection(doc, GUIDED_ACTIONS_HEADING)
  .split('\n')
  .filter((line) => line.trim().startsWith('|'))
  .map((line) =>
    line
      .trim()
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim())
  );
const guidedColumn = guidedActionRows[0]?.indexOf('`guided`') ?? -1;
const actionColumn = guidedActionRows[0]?.indexOf('Action') ?? -1;
const guidedActions: readonly string[] = GUIDED_ACTION_TYPES;
const rejectedGuidedActions = JsonInteractiveActionSchema.options.filter((action) => !guidedActions.includes(action));
const headings = doc
  .split('\n')
  .filter((line) => line.startsWith('#### '))
  .map((line) => normalize(line));

/**
 * True when a heading is explained by a longer block type — `terminal` must
 * not be satisfied by the `terminal-connect` heading.
 */
function claimedByLongerType(heading: string, blockType: string): boolean {
  return blockTypes.some(
    (other) => other !== blockType && other.length > blockType.length && heading.includes(normalize(other))
  );
}

describe('JSON guide format reference', () => {
  describe('guided-action table', () => {
    it('locates the action and guided columns', () => {
      expect(
        (actionColumn >= 0 && guidedColumn >= 0) ||
          `No Action and \`guided\` columns found under "${GUIDED_ACTIONS_HEADING}" in ${DOC_RELATIVE_PATH}.`
      ).toBe(true);
    });

    it.each([
      ...guidedActions.map((action) => [action, '✅']),
      ...rejectedGuidedActions.map((action) => [action, '❌']),
    ])('documents %s with %s in the guided column', (action, marker) => {
      const rows = guidedActionRows.filter((row) => row[actionColumn] === `\`${action}\``);
      expect(
        rows.length === 1 ||
          `Action "${action}" needs exactly one row under "${GUIDED_ACTIONS_HEADING}" in ${DOC_RELATIVE_PATH}; found ${rows.length}.`
      ).toBe(true);
      expect(
        rows[0]?.[guidedColumn] === marker ||
          `Action "${action}" must show ${marker} in the \`guided\` column in ${DOC_RELATIVE_PATH}; found "${rows[0]?.[guidedColumn]}".`
      ).toBe(true);
    });
  });

  it('reads every block type out of the schema union', () => {
    expect(blockTypes).toContain('markdown');
    expect(blockTypes).toHaveLength(EXPECTED_BLOCK_TYPE_COUNT);
  });

  it('locates the block types summary table', () => {
    expect(
      summaryTable.includes('| Block Type') ||
        `No "${SUMMARY_HEADING}" table found in ${DOC_RELATIVE_PATH}; the per-type row checks cannot run.`
    ).toBe(true);
  });

  describe.each(blockTypes)('%s', (blockType) => {
    it('has a row in the block types summary table', () => {
      const hasRow = summaryTable.includes(`| \`${blockType}\``);
      expect(
        hasRow ||
          `Block type "${blockType}" has no summary-table row. Add one to the "Block Types Summary" table in ${DOC_RELATIVE_PATH}.`
      ).toBe(true);
    });

    it('has a per-type section heading', () => {
      const normalized = normalize(blockType);
      const hasHeading = headings.some(
        (heading) => heading.includes(normalized) && !claimedByLongerType(heading, blockType)
      );
      expect(
        hasHeading ||
          `Block type "${blockType}" has no "#### " section. Add one to ${DOC_RELATIVE_PATH} describing its fields.`
      ).toBe(true);
    });
  });
});
