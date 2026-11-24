import { TranslationManifestEntrySchema } from '../../../types/translation-sidecar.schema';
import { contextOf, sidecarOf } from '../../../test-utils/sidecar-check-context';
import { manifestBlockFieldsCheck } from './manifest-block-fields';

const FORBIDDEN_FIELDS = [
  'author',
  'id',
  'type',
  'depends',
  'recommends',
  'suggests',
  'provides',
  'conflicts',
  'replaces',
  'targeting',
  'milestones',
  'startingLocation',
  'estimatedMinutes',
  'testEnvironment',
];

const run = (manifest: Record<string, unknown> | undefined, tag = 'ja') =>
  manifestBlockFieldsCheck.run(contextOf([sidecarOf(tag, { manifest })]));

describe('manifest-block-fields check', () => {
  it('allows the translatable and tooling fields', () => {
    expect(run({ description: 'd', category: 'c', reviewed: true, _sourceHash: 'sha256:x' })).toEqual([]);
  });

  it('allows every field the sidecar schema declares for the manifest block', () => {
    const declared = Object.fromEntries(Object.keys(TranslationManifestEntrySchema.shape).map((key) => [key, 'x']));
    expect(run(declared)).toEqual([]);
  });

  it('finds nothing in a sidecar with no manifest block', () => {
    expect(run(undefined)).toEqual([]);
  });

  it.each(FORBIDDEN_FIELDS)('reports the structural field %s as an error', (field) => {
    expect(run({ [field]: 'x' })).toEqual([
      {
        severity: 'error',
        code: 'sidecar_manifest_block_field',
        message: expect.stringContaining(`"${field}" is structural`),
        path: ['i18n/ja.json', 'manifest', field],
      },
    ]);
  });

  it('reports an unlisted key as an error', () => {
    expect(run({ description: 'd', tagline: 'x' })).toEqual([
      {
        severity: 'error',
        code: 'sidecar_manifest_block_field',
        message: expect.stringContaining('"tagline" is not translatable'),
        path: ['i18n/ja.json', 'manifest', 'tagline'],
      },
    ]);
  });

  it('reports each offending key, in file order, and names the file', () => {
    const findings = run({ targeting: {}, description: 'd', milestones: [] }, 'ja-JP');
    expect(findings.map((finding) => finding.path)).toEqual([
      ['i18n/ja-JP.json', 'manifest', 'targeting'],
      ['i18n/ja-JP.json', 'manifest', 'milestones'],
    ]);
    expect(findings.every((finding) => finding.message.startsWith('i18n/ja-JP.json: '))).toBe(true);
  });

  it('checks every sidecar', () => {
    const findings = manifestBlockFieldsCheck.run(
      contextOf([sidecarOf('es', { manifest: { id: 'x' } }), sidecarOf('ja', { manifest: { type: 'path' } })])
    );
    expect(findings.map((finding) => finding.path[0])).toEqual(['i18n/es.json', 'i18n/ja.json']);
  });
});
