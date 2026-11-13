/**
 * @jest-environment node
 */

import type { JsonBlock } from '../../types/json-guide.types';
import {
  canonicalBlockSource,
  canonicalizeSourceText,
  hashBlockSource,
  hashGuideTitleSource,
  hashManifestSource,
  isWellFormedSourceHash,
} from './source-hash';

// NFD spellings are built from escapes so the file holds no combining marks.
const CAFE_NFC = 'Café ガイド';
const CAFE_NFD = 'Café ガイド';

const markdown = (content: string, id = 'intro'): JsonBlock => ({ type: 'markdown', id, content });

const multistep = (steps: Array<{ id: string; description: string }>, id = 'save'): JsonBlock => ({
  type: 'multistep',
  id,
  content: 'Save the dashboard.',
  steps: steps.map((step) => ({
    id: step.id,
    action: 'button',
    reftarget: `[data-testid="${step.id}"]`,
    description: step.description,
  })),
});

const OPEN = { id: 'open-save', description: 'Open the save dialog.' };
const CONFIRM = { id: 'confirm-save', description: 'Confirm the save.' };

/**
 * Golden vectors: the compile step, `validate` and `sync-translations` must
 * all produce these exact strings. Changing one is a breaking change to every
 * stamped sidecar.
 */
const GOLDEN = {
  markdown: 'sha256:2690877094427699f8f897477f66c1f9e45acc6c81e91c57c590c737010303d6',
  multistep: 'sha256:e9d0b2aeb51eadea2678e5bddb99ba7b587c207ce5933710d7e80bd781c8da1d',
  interactiveWithoutTooltip: 'sha256:2410f5f61a67352a4ad2e832f69159f361918530e9c595e4aec40855bd5a4f78',
  interactiveWithEmptyTooltip: 'sha256:f0141c46a9a409b46c8522b64107734b4dbaa7128ec657065edfc0accad8500a',
  conditional: 'sha256:71b07d466aa3710093b5cf54e6d83286427dbd557afbdf7934b226ea869fe898',
  manifest: 'sha256:747b554315ecea5282d0c3a3cd7652534f171e56efb1f88740c3138f3a0e69fb',
  guideTitle: 'sha256:d11262622e9a52c1e406e9f43831f05899b80294148ff8f7bc7b4902d816b771',
};

describe('canonicalizeSourceText', () => {
  it('composes to NFC', () => {
    expect(canonicalizeSourceText(CAFE_NFD)).toBe(CAFE_NFC);
  });

  it('rewrites CRLF and lone CR to LF', () => {
    expect(canonicalizeSourceText('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
  });
});

describe('canonicalBlockSource', () => {
  it('serializes the table fields in table order, then the steps', () => {
    expect(canonicalBlockSource(multistep([OPEN, CONFIRM]))).toBe(
      '{"content":"Save the dashboard.","steps":[{"description":"Open the save dialog."},{"description":"Confirm the save."}]}'
    );
  });

  it('is undefined for a block type outside the projection table', () => {
    expect(canonicalBlockSource({ type: 'html', id: 'raw', content: '<p>Hi</p>' })).toBeUndefined();
  });
});

describe('source hash golden vectors', () => {
  it('matches the committed vectors', async () => {
    await expect(hashBlockSource(markdown(CAFE_NFC))).resolves.toBe(GOLDEN.markdown);
    await expect(hashBlockSource(multistep([OPEN, CONFIRM]))).resolves.toBe(GOLDEN.multistep);
    await expect(
      hashBlockSource({ type: 'interactive', id: 'add', action: 'highlight', reftarget: '#a', content: 'Add.' })
    ).resolves.toBe(GOLDEN.interactiveWithoutTooltip);
    await expect(
      hashBlockSource({
        type: 'interactive',
        id: 'add',
        action: 'highlight',
        reftarget: '#a',
        content: 'Add.',
        tooltip: '',
      })
    ).resolves.toBe(GOLDEN.interactiveWithEmptyTooltip);
    await expect(
      hashBlockSource({
        type: 'conditional',
        id: 'has-ds',
        conditions: ['has-datasource:prometheus'],
        description: 'Depends on your data source.',
        whenTrueSectionConfig: { title: 'You have Prometheus' },
        whenTrue: [],
        whenFalse: [],
      })
    ).resolves.toBe(GOLDEN.conditional);
    await expect(hashManifestSource({ description: 'Learn dashboards.', category: 'Getting started' })).resolves.toBe(
      GOLDEN.manifest
    );
    await expect(hashGuideTitleSource('Create your first dashboard')).resolves.toBe(GOLDEN.guideTitle);
  });

  it('has the sha256:<lowercase hex> shape', () => {
    for (const hash of Object.values(GOLDEN)) {
      expect(isWellFormedSourceHash(hash)).toBe(true);
    }
  });

  it('gives NFC and NFD input the same hash', async () => {
    expect(await hashBlockSource(markdown(CAFE_NFD))).toBe(await hashBlockSource(markdown(CAFE_NFC)));
  });

  it('gives CRLF, CR and LF line endings the same hash', async () => {
    const lf = await hashBlockSource(markdown('one\ntwo'));
    expect(await hashBlockSource(markdown('one\r\ntwo'))).toBe(lf);
    expect(await hashBlockSource(markdown('one\rtwo'))).toBe(lf);
  });

  it('changes the hash when steps are reordered', async () => {
    expect(await hashBlockSource(multistep([CONFIRM, OPEN]))).not.toBe(
      await hashBlockSource(multistep([OPEN, CONFIRM]))
    );
  });

  it('keeps the hash when a block id or a step id is renamed', async () => {
    const original = await hashBlockSource(multistep([OPEN, CONFIRM]));
    expect(await hashBlockSource(multistep([OPEN, CONFIRM], 'save-renamed'))).toBe(original);
    expect(await hashBlockSource(multistep([{ ...OPEN, id: 'open-renamed' }, CONFIRM]))).toBe(original);
  });

  it('keeps the hash when only structural fields change', async () => {
    const block = { type: 'interactive', id: 'add', action: 'highlight', reftarget: '#a', content: 'Add.' } as const;
    expect(await hashBlockSource({ ...block, reftarget: '#b', action: 'button' })).toBe(await hashBlockSource(block));
  });

  it('hashes an absent field and an empty-string field differently', () => {
    expect(GOLDEN.interactiveWithEmptyTooltip).not.toBe(GOLDEN.interactiveWithoutTooltip);
  });

  it('hashes an absent and an empty manifest field differently', async () => {
    expect(await hashManifestSource({ description: 'Learn dashboards.' })).not.toBe(
      await hashManifestSource({ description: 'Learn dashboards.', category: '' })
    );
  });

  it('covers only description and category in the manifest hash', async () => {
    expect(await hashManifestSource({ description: 'Learn dashboards.', category: 'Getting started' })).toBe(
      GOLDEN.manifest
    );
    expect(
      await hashManifestSource({
        description: 'Learn dashboards.',
        category: 'Getting started',
        author: { name: 'Someone' },
      } as { description: string; category: string })
    ).toBe(GOLDEN.manifest);
  });

  it('is undefined for a block type outside the projection table', async () => {
    await expect(hashBlockSource({ type: 'html', id: 'raw', content: '<p>Hi</p>' })).resolves.toBeUndefined();
  });
});

describe('isWellFormedSourceHash', () => {
  it.each([
    `sha256:${'A'.repeat(64)}`,
    `sha256:${'0'.repeat(63)}`,
    `sha1:${'0'.repeat(64)}`,
    '0'.repeat(64),
    5,
    undefined,
  ])('rejects %p', (value) => {
    expect(isWellFormedSourceHash(value)).toBe(false);
  });
});
