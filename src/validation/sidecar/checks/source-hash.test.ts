/**
 * @jest-environment node
 */

import * as fs from 'fs';
import * as path from 'path';

import type { SidecarReadSuccess } from '../../../cli/utils/package-io';
import { isEntryReviewed } from '../../../lib/guide-translation/review';
import { contextOf, sidecarOf } from '../../../test-utils/sidecar-check-context';
import { ContentJsonSchema, ManifestJsonSchema } from '../../../types/package.schema';
import type { ContentJson, ManifestJson } from '../../../types/package.types';
import { TranslationSidecarSchema, type TranslationEntry } from '../../../types/translation-sidecar.schema';
import { SIDECAR_HASH_FUNCTIONS } from '../hash';
import type { SidecarCheckContext } from '../types';
import { sourceHashCheck } from './source-hash';

type Loose = Record<string, any>;

const hash = SIDECAR_HASH_FUNCTIONS;
const SYNC = 'pathfinder-cli sync-translations <dir>';
const MALFORMED = 'sha256:NOT-A-HASH';

const markdown = (id: string, text: string) => ({ type: 'markdown' as const, id, content: text });
const guide = (blocks: Loose[], title = 'Guide') => ({ id: 'guide', title, blocks }) as unknown as ContentJson;

/** A reviewed entry whose `_reviewHash` covers its text, so the review counts. */
function reviewed(entry: Loose): Loose {
  return { ...entry, reviewed: true, _reviewHash: hash.entryText(entry) };
}

function run(blocks: Loose[], sidecar: Loose, overrides: Partial<SidecarCheckContext> = {}) {
  return sourceHashCheck.run(contextOf([sidecarOf('ja', sidecar)], { content: guide(blocks), ...overrides }));
}

describe('source-hash check', () => {
  const intro = markdown('intro', 'Hello');
  const introHash = hash.block(intro);

  it('finds nothing for a reviewed entry whose source hash matches', () => {
    expect(run([intro], { blocks: { intro: reviewed({ content: 'こんにちは', _sourceHash: introHash }) } })).toEqual(
      []
    );
  });

  describe('missing hash', () => {
    it('is an error on a block, guide or manifest entry with translated text, reviewed or not', () => {
      const manifest = { description: 'Build it.', category: 'Dashboards' } as ManifestJson;
      const findings = run(
        [intro],
        {
          guide: { title: 'ガイド' },
          manifest: reviewed({ description: '作る' }),
          blocks: { intro: { content: 'こんにちは' } },
        },
        { manifest }
      );
      expect(findings).toEqual([
        {
          severity: 'error',
          code: 'sidecar_missing_source_hash',
          message: expect.stringContaining('i18n/ja.json: guide has a translation but no _sourceHash'),
          path: ['i18n/ja.json', 'guide'],
          remediation: SYNC,
        },
        expect.objectContaining({ code: 'sidecar_missing_source_hash', path: ['i18n/ja.json', 'manifest'] }),
        expect.objectContaining({ code: 'sidecar_missing_source_hash', path: ['i18n/ja.json', 'blocks', 'intro'] }),
      ]);
    });

    it('stays an error with allowStaleTranslations', () => {
      const findings = run([intro], { blocks: { intro: { content: 'こんにちは' } } }, { allowStaleTranslations: true });
      expect(findings.map((finding) => [finding.severity, finding.code])).toEqual([
        ['error', 'sidecar_missing_source_hash'],
      ]);
    });

    it('skips an entry that holds no translated strings', () => {
      expect(run([intro], { guide: { reviewed: true }, blocks: { intro: { reviewed: false } } })).toEqual([]);
    });
  });

  describe('stale', () => {
    const stale = { intro: reviewed({ content: 'こんにちは', _sourceHash: hash.block(markdown('intro', 'Hi')) }) };

    it('is an error naming both fixes, with the --accept spelling as remediation', () => {
      const accept = `${SYNC} --locale ja --accept intro`;
      expect(run([intro], { blocks: stale })).toEqual([
        {
          severity: 'error',
          code: 'sidecar_stale_translation',
          message: expect.stringMatching(/blocks\.intro .*Update the translation in the same change.*--accept intro$/),
          path: ['i18n/ja.json', 'blocks', 'intro'],
          remediation: accept,
        },
      ]);
    });

    it('is a warning with the same remediation under allowStaleTranslations', () => {
      expect(run([intro], { blocks: stale }, { allowStaleTranslations: true })).toEqual([
        expect.objectContaining({
          severity: 'warn',
          code: 'sidecar_stale_translation',
          remediation: `${SYNC} --locale ja --accept intro`,
        }),
      ]);
    });

    it('treats a malformed hash on a reviewed entry as stale, not as a separate error', () => {
      const findings = run([intro], { blocks: { intro: reviewed({ content: 'こんにちは', _sourceHash: MALFORMED }) } });
      expect(findings.map((finding) => finding.code)).toEqual(['sidecar_stale_translation']);
    });

    it('spells a block named like a reserved entry with the block: prefix', () => {
      const block = markdown('guide', 'Hello');
      const findings = run([block], {
        blocks: { guide: reviewed({ content: 'こんにちは', _sourceHash: MALFORMED }) },
      });
      expect(findings[0]?.remediation).toBe(`${SYNC} --locale ja --accept block:guide`);
    });

    it('does not report an unreviewed entry, or one whose review lapsed', () => {
      const old = hash.block(markdown('intro', 'Hi'));
      const lapsed = { ...reviewed({ content: 'こんにちは', _sourceHash: old }), content: 'やあ' };
      expect(run([intro], { blocks: { intro: { content: 'こんにちは', _sourceHash: old } } })).toEqual([]);
      expect(run([intro], { blocks: { intro: { content: 'こんにちは', reviewed: true, _sourceHash: old } } })).toEqual(
        []
      );
      expect(run([intro], { blocks: { intro: lapsed } })).toEqual([]);
    });

    it('leaves a key with no block, or a block type outside the table, to the other checks', () => {
      const html = { type: 'html', id: 'raw', content: '<p>Hi</p>' };
      const entry = reviewed({ content: 'こんにちは', _sourceHash: MALFORMED });
      expect(run([intro, html], { blocks: { gone: entry, raw: entry } })).toEqual([]);
    });

    it('does not ask for a hash where there is no English for sync-translations to hash', () => {
      const unstamped = { content: 'こんにちは' };
      expect(run([intro], { manifest: { description: '作る' }, blocks: { gone: unstamped } })).toEqual([]);
    });
  });

  it('agrees with isEntryReviewed on which entries count as reviewed', async () => {
    const valid = reviewed({ content: 'a' });
    const entries: Loose[] = [
      valid,
      { ...valid, content: 'b' },
      { ...valid, reviewed: false },
      { content: 'a', reviewed: true },
      { ...valid, _reviewHash: MALFORMED },
    ];
    const old = hash.block(markdown('intro', 'Hi'));
    for (const entry of entries) {
      const findings = run([intro], { blocks: { intro: { ...entry, _sourceHash: old } } });
      expect(findings.length === 1).toBe(await isEntryReviewed(entry as TranslationEntry));
    }
  });

  describe('golden translation fixture', () => {
    const dir = path.join(__dirname, '../../../lib/guide-translation/fixtures/packages/translation-golden');
    const read = (...segments: string[]) => JSON.parse(fs.readFileSync(path.join(dir, ...segments), 'utf-8'));
    const content = ContentJsonSchema.parse(read('content.json')) as ContentJson;
    const manifest = ManifestJsonSchema.parse(read('manifest.json')) as ManifestJson;
    const sidecars: SidecarReadSuccess[] = ['ja', 'ja-JP'].map((tag) => ({
      ok: true,
      tag,
      filePath: path.join(dir, 'i18n', `${tag}.json`),
      sidecar: TranslationSidecarSchema.parse(read('i18n', `${tag}.json`)),
    }));
    const check = (edited: Partial<SidecarCheckContext>) =>
      sourceHashCheck.run(contextOf(sidecars, { content, manifest, ...edited }));

    it('finds nothing in the fixture as committed', () => {
      expect(check({})).toEqual([]);
    });

    it('reports only the manifest entry when only the manifest description changes', () => {
      const findings = check({ manifest: { ...manifest, description: 'Something else.' } });
      expect(findings.map((finding) => finding.path)).toEqual([['i18n/ja.json', 'manifest']]);
    });

    it('reports only the guide entry when only the English title changes', () => {
      const findings = check({ content: { ...content, title: 'A different title' } });
      expect(findings.map((finding) => finding.path)).toEqual([['i18n/ja.json', 'guide']]);
    });
  });
});
