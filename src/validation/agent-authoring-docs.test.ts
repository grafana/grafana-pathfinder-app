/**
 * Fidelity of the schema quotes in the agent-authoring design doc.
 *
 * `AGENT-AUTHORING.md` presents an excerpt of `JsonInteractiveBlockSchema`
 * and the generated `objectives` description as literal quotes, and authoring
 * agents read them as the spec. A paraphrase there is the same defect the doc
 * exists to prevent, so every quoted run must still appear verbatim in the
 * schema it claims to quote.
 */

import * as fs from 'fs';
import * as path from 'path';

import { JsonInteractiveBlockSchema } from '../types/json-guide.schema';

const REPO_ROOT = path.resolve(__dirname, '../..');
const DOC_RELATIVE_PATH = 'docs/design/AGENT-AUTHORING.md';
const SCHEMA_RELATIVE_PATH = 'src/types/json-guide.schema.ts';

/** First line of the quoted excerpt, naming the file it is copied from. */
const EXCERPT_MARKER = `// ${SCHEMA_RELATIVE_PATH}`;
/** Marks omitted fields, so the excerpt is a set of contiguous runs rather than one. */
const ELISION = '// ...';

interface FencedBlock {
  language: string;
  body: string;
}

function read(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function fencedBlocks(markdown: string): FencedBlock[] {
  const blocks: FencedBlock[] = [];
  const pattern = /^```(\w*)\n([\s\S]*?)^```$/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown)) !== null) {
    blocks.push({ language: match[1] ?? '', body: match[2] ?? '' });
  }
  return blocks;
}

function withoutBlankEdges(lines: string[]): string[] {
  const trimmed = [...lines];
  while (trimmed.length > 0 && trimmed[0]!.trim() === '') {
    trimmed.shift();
  }
  while (trimmed.length > 0 && trimmed[trimmed.length - 1]!.trim() === '') {
    trimmed.pop();
  }
  return trimmed;
}

/** The excerpt's contiguous runs, indentation preserved so a substring check verifies alignment too. */
function excerptRuns(body: string): string[] {
  const lines = body.split('\n');
  expect(lines[0]).toBe(EXCERPT_MARKER);

  const runs: string[][] = [[]];
  for (const line of lines.slice(1)) {
    if (line.trim() === ELISION) {
      runs.push([]);
    } else {
      runs[runs.length - 1]!.push(line);
    }
  }
  return runs.map((run) => withoutBlankEdges(run).join('\n')).filter((run) => run !== '');
}

function objectivesDescription(): string {
  const { shape } = JsonInteractiveBlockSchema as unknown as { shape: Record<string, { description?: string }> };
  return shape.objectives?.description ?? '';
}

describe('AGENT-AUTHORING.md schema quotes', () => {
  const blocks = fencedBlocks(read(DOC_RELATIVE_PATH));
  const excerptIndex = blocks.findIndex(
    (block) => block.language === 'typescript' && block.body.startsWith(EXCERPT_MARKER)
  );

  it('carries a schema excerpt labelled with the file it quotes', () => {
    expect(excerptIndex).toBeGreaterThanOrEqual(0);
  });

  it('quotes the interactive block schema verbatim', () => {
    const schema = read(SCHEMA_RELATIVE_PATH);
    const runs = excerptRuns(blocks[excerptIndex]!.body);

    expect(runs.length).toBeGreaterThan(1);
    for (const run of runs) {
      expect(run.split('\n').length).toBeGreaterThan(1);
      expect(schema).toContain(run);
    }
  });

  it('quotes the generated objectives description verbatim', () => {
    const quoted = blocks.slice(excerptIndex + 1).find((block) => block.language === 'text');

    expect(quoted).toBeDefined();
    expect(quoted!.body.trimEnd()).toBe(objectivesDescription());
  });
});
