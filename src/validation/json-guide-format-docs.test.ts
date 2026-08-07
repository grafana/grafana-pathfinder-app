/**
 * Documentation coverage for the JSON guide format reference.
 *
 * Every block type in the `JsonBlockSchema` union must have a row in the
 * "Block Types Summary" table and a per-type section heading in
 * json-guide-format.md. Block types are read out of the schema at runtime, so
 * adding a variant to the union fails this test until the reference documents
 * it. Coverage only — the prose itself stays hand-written.
 */

import * as fs from 'fs';
import * as path from 'path';

import { JsonBlockSchema } from '../types/json-guide.schema';

const DOC_RELATIVE_PATH = 'docs/developer/interactive-examples/json-guide-format.md';
const DOC_PATH = path.resolve(__dirname, '../..', DOC_RELATIVE_PATH);

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

/** Compare heading text to type names ignoring case, hyphens, and spacing. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const blockTypes = blockTypesFromSchema();
const doc = fs.readFileSync(DOC_PATH, 'utf-8');
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
  it('reads every block type out of the schema union', () => {
    expect(blockTypes).toContain('markdown');
    expect(blockTypes.length).toBeGreaterThan(15);
  });

  describe.each(blockTypes)('%s', (blockType) => {
    it('has a row in the block types summary table', () => {
      const hasRow = doc.includes(`| \`${blockType}\``);
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
