/**
 * The translation fields the guide i18n contract adds to existing schemas
 * (docs/design/I18N.md §7.2, §7.4). Guides and packages without them must
 * parse exactly as before.
 */

import * as fs from 'fs';
import * as path from 'path';

import { JsonGuideSchemaStrict } from '../types/json-guide.schema';
import {
  ContentJsonSchema,
  ManifestJsonObjectSchema,
  RepositoryEntrySchema,
  RepositoryJsonSchema,
} from '../types/package.schema';
import { detectUnknownFields } from './unknown-fields';

const ANNOTATION = {
  language: 'ja',
  canonicalLanguage: 'en',
  canonicalTitle: 'Create your first dashboard',
  staleBlockIds: ['add-panel'],
  fallbackBlockIds: [],
};

const COMPILED = {
  id: 'first-dashboard',
  title: '最初のダッシュボードを作成する',
  blocks: [{ type: 'markdown', id: 'intro', content: 'ようこそ' }],
  translation: ANNOTATION,
};

describe('translation annotation on a compiled guide', () => {
  it('survives a ContentJsonSchema read instead of being stripped', () => {
    const result = ContentJsonSchema.safeParse(COMPILED);
    expect(result.success).toBe(true);
    expect(result.data?.translation).toEqual(ANNOTATION);
  });

  it('is accepted by the strict guide schema', () => {
    expect(JsonGuideSchemaStrict.safeParse(COMPILED).success).toBe(true);
  });

  it('is a known guide field, so it raises no unknown-field warning', () => {
    expect(detectUnknownFields(COMPILED)).toEqual([]);
  });

  it.each([
    ['without staleBlockIds', { ...ANNOTATION, staleBlockIds: undefined }],
    ['with a non-string block id', { ...ANNOTATION, fallbackBlockIds: [3] }],
    ['without a language', { ...ANNOTATION, language: '' }],
  ])('rejects an annotation %s', (_label, translation) => {
    expect(ContentJsonSchema.safeParse({ ...COMPILED, translation }).success).toBe(false);
    expect(JsonGuideSchemaStrict.safeParse({ ...COMPILED, translation }).success).toBe(false);
  });

  it('leaves a canonical guide without the field', () => {
    const { translation: _omit, ...canonical } = COMPILED;
    const result = ContentJsonSchema.safeParse(canonical);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(canonical);
  });
});

describe('translations on the manifest and the repository entry', () => {
  it('parses on a manifest', () => {
    const result = ManifestJsonObjectSchema.safeParse({ id: 'first-dashboard', type: 'guide', translations: ['ja'] });
    expect(result.success).toBe(true);
    expect(result.data?.translations).toEqual(['ja']);
  });

  it('is absent from a manifest that does not declare it', () => {
    const result = ManifestJsonObjectSchema.safeParse({ id: 'first-dashboard', type: 'guide' });
    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty('translations');
  });

  it('parses on a repository entry', () => {
    const result = RepositoryEntrySchema.safeParse({ path: 'first-dashboard/', type: 'guide', translations: ['ja'] });
    expect(result.success).toBe(true);
    expect(result.data?.translations).toEqual(['ja']);
  });

  it.each([
    ['manifest', () => ManifestJsonObjectSchema.safeParse({ id: 'g', type: 'guide', translations: 'ja' })],
    ['repository entry', () => RepositoryEntrySchema.safeParse({ path: 'g/', type: 'guide', translations: [5] })],
  ])('rejects a malformed list on a %s', (_label, parse) => {
    expect(parse().success).toBe(false);
  });

  it('leaves the bundled repository.json unchanged', () => {
    const raw = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'bundled-interactives', 'repository.json'), 'utf-8')
    ) as unknown;
    const result = RepositoryJsonSchema.safeParse(raw);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(raw);
  });
});
