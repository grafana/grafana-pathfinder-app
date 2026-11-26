import * as fs from 'fs';
import * as path from 'path';

import { PROJECTION_TABLE } from '../../../lib/guide-translation/projection-table';
import { contextOf, sidecarOf } from '../../../test-utils/sidecar-check-context';
import type { ContentJson } from '../../../types/package.types';
import { projectionConformanceCheck } from './projection-conformance';

type Loose = Record<string, any>;

const guide = (blocks: Loose[]) => ({ id: 'guide', title: 'Guide', blocks }) as unknown as ContentJson;
const run = (blocks: Loose[], entries: Loose) =>
  projectionConformanceCheck.run(contextOf([sidecarOf('ja', { blocks: entries })], { content: guide(blocks) }));
const codes = (blocks: Loose[], entries: Loose) => run(blocks, entries).map((finding) => finding.code);

const ROWS = Object.entries(PROJECTION_TABLE) as Array<
  [string, { fields: readonly string[]; stepFields?: readonly string[] }]
>;
const TOOLING = { reviewed: true, _sourceHash: `sha256:${'a'.repeat(64)}`, _reviewHash: `sha256:${'b'.repeat(64)}` };

describe('projection-conformance check', () => {
  it.each(ROWS)('allows every table field and the tooling fields on a %s block', (type, row) => {
    const entry = { ...Object.fromEntries(row.fields.map((field) => [field, 'x'])), ...TOOLING };
    expect(run([{ type, id: 'b' }], { b: entry })).toEqual([]);
  });

  it.each(ROWS)('rejects a field the table does not list for a %s block', (type, row) => {
    expect(run([{ type, id: 'b' }], { b: { notAField: 'x' } })).toEqual([
      {
        severity: 'error',
        code: 'sidecar_field_not_translatable',
        message: expect.stringContaining(`translates only ${row.fields.join(', ')}`),
        path: ['i18n/ja.json', 'blocks', 'b', 'notAField'],
      },
    ]);
  });

  it('rejects a field another type lists, such as tooltip on markdown, whatever its value type', () => {
    expect(codes([{ type: 'markdown', id: 'b' }], { b: { tooltip: 'x', hint: 3 } })).toEqual([
      'sidecar_field_not_translatable',
      'sidecar_field_not_translatable',
    ]);
  });

  it.each([
    'id',
    'type',
    'action',
    'reftarget',
    'requirements',
    'targeting',
    'targetvalue',
    'blocks',
    'whenTrue',
    'whenFalse',
  ])('names the structural field %s and its block', (field) => {
    const findings = run([{ type: 'interactive', id: 'open' }], { open: { [field]: 'x' } });
    expect(findings).toEqual([
      {
        severity: 'error',
        code: 'sidecar_structural_field',
        message: expect.stringMatching(new RegExp(`"${field}" is structural on interactive block "open"`)),
        path: ['i18n/ja.json', 'blocks', 'open', field],
      },
    ]);
  });

  it('rejects an entry for a block type outside the table', () => {
    for (const type of ['quiz', 'challenge', 'html', 'callout']) {
      expect(codes([{ type, id: 'b' }], { b: { content: 'x' } })).toEqual(['sidecar_block_type_not_translatable']);
    }
  });

  it.each(ROWS.filter(([, row]) => !row.stepFields))('rejects steps on a %s block', (type) => {
    expect(run([{ type, id: 'b' }], { b: { steps: { s: { description: 'x' } } } })).toEqual([
      expect.objectContaining({ code: 'sidecar_steps_not_allowed', path: ['i18n/ja.json', 'blocks', 'b', 'steps'] }),
    ]);
  });

  it.each(ROWS.filter(([, row]) => row.stepFields))(
    'allows the step fields on a %s block and names any other with its step path',
    (type, row) => {
      const allowed = Object.fromEntries(row.stepFields!.map((field) => [field, 'x']));
      expect(run([{ type, id: 'b' }], { b: { steps: { s: allowed } } })).toEqual([]);
      expect(run([{ type, id: 'b' }], { b: { steps: { s: { reftarget: 'x' } } } })).toEqual([
        expect.objectContaining({
          code: 'sidecar_field_not_translatable',
          path: ['i18n/ja.json', 'blocks', 'b', 'steps', 's', 'reftarget'],
        }),
      ]);
    }
  );

  it('rejects an underscore key that is not a tooling field', () => {
    expect(run([{ type: 'markdown', id: 'b' }], { b: { content: 'x', _note: 'mine' } })).toEqual([
      expect.objectContaining({ code: 'sidecar_reserved_field', path: ['i18n/ja.json', 'blocks', 'b', '_note'] }),
    ]);
  });

  it("reads a conditional's dotted section titles verbatim", () => {
    expect(run([{ type: 'conditional', id: 'c' }], { c: { 'whenTrueSectionConfig.title': 'x' } })).toEqual([]);
    expect(codes([{ type: 'conditional', id: 'c' }], { c: { whenTrueSectionConfig: { title: 'x' } } })).toEqual([
      'sidecar_field_not_translatable',
    ]);
  });

  it('checks nested blocks and leaves a key with no block to the orphan-key check', () => {
    const blocks = [{ type: 'section', id: 's', title: 'S', blocks: [{ type: 'markdown', id: 'inner' }] }];
    expect(codes(blocks, { inner: { reftarget: 'x' }, gone: { reftarget: 'x' } })).toEqual([
      'sidecar_structural_field',
    ]);
  });
});

describe('projection-conformance on the golden translation fixture', () => {
  it('finds nothing in either sidecar', () => {
    const dir = path.join(__dirname, '../../../lib/guide-translation/fixtures/packages/translation-golden');
    const read = (...segments: string[]) => JSON.parse(fs.readFileSync(path.join(dir, ...segments), 'utf-8'));
    const sidecars = ['ja', 'ja-JP'].map((tag) => sidecarOf(tag, read('i18n', `${tag}.json`)));
    expect(projectionConformanceCheck.run(contextOf(sidecars, { content: read('content.json') }))).toEqual([]);
  });
});
