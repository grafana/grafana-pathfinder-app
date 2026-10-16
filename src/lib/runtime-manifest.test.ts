import { ManifestJsonObjectSchema, ManifestJsonSchema } from '../types/package.schema';
import { RuntimeManifestJsonObjectSchema } from './runtime-manifest';

const pathManifest = {
  id: 'test-path',
  type: 'path',
  repository: 'test-repository',
  milestones: ['first', 'second'],
  tracks: [{ trackId: 'extra', label: 'Extra', guides: ['track-member'] }],
  startingLocation: '/dashboards',
};

const malformedPrerequisites = [
  [
    { id: 'duplicate', label: 'First' },
    { id: 'duplicate', label: 'Second' },
  ],
  [null],
  [{ id: 'numeric-label', label: 42 }],
  { id: 'not-an-array', label: 'Setup' },
  [{ id: ' ', label: 'Blank ID' }],
  [{ id: 'blank-label', label: ' ' }],
  [{ id: 'valid', label: 'Valid' }, null],
];

describe('runtime manifest prerequisites', () => {
  it('accepts the underlying path in both runtime and authoring schemas', () => {
    expect(RuntimeManifestJsonObjectSchema.parse(pathManifest)).toMatchObject(pathManifest);
    expect(ManifestJsonObjectSchema.safeParse(pathManifest).success).toBe(true);
    expect(ManifestJsonSchema.safeParse(pathManifest).success).toBe(true);
  });

  it.each(malformedPrerequisites.map((prerequisites) => [prerequisites]))(
    'omits invalid prerequisites %p without losing path metadata',
    (prerequisites) => {
      const manifest = { ...pathManifest, prerequisites };
      const parsed = RuntimeManifestJsonObjectSchema.parse(manifest);

      expect(parsed).toMatchObject(pathManifest);
      expect(parsed.prerequisites).toBeUndefined();
      expect(ManifestJsonObjectSchema.safeParse(manifest).success).toBe(false);
      expect(ManifestJsonSchema.safeParse(manifest).success).toBe(false);
      expect(manifest.prerequisites).toBe(prerequisites);
    }
  );

  it('preserves exact valid declarations and normalizes only unsupported formats', () => {
    const prerequisites = [
      { id: ' padded ', label: ' <b>Literal</b> ', format: 42 },
      { id: 'padded', label: '**Markdown**', format: 'markdown' },
      { id: 'plain', label: 'Plain' },
    ];
    const manifest = { ...pathManifest, prerequisites };
    const parsed = RuntimeManifestJsonObjectSchema.parse(manifest);

    expect(parsed).toMatchObject(pathManifest);
    expect(parsed.prerequisites).toEqual([
      { id: ' padded ', label: ' <b>Literal</b> ' },
      { id: 'padded', label: '**Markdown**', format: 'markdown' },
      { id: 'plain', label: 'Plain' },
    ]);
    expect(manifest.prerequisites[0]?.format).toBe(42);
  });

  it('does not weaken validation of manifest identity or navigation fields', () => {
    expect(RuntimeManifestJsonObjectSchema.safeParse({ ...pathManifest, id: 'Bad_ID' }).success).toBe(false);
    expect(RuntimeManifestJsonObjectSchema.safeParse({ ...pathManifest, milestones: [42] }).success).toBe(false);
  });
});
