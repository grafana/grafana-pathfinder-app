/**
 * @jest-environment node
 */

import {
  hashBlockSource,
  hashGuideTitleSource,
  hashManifestSource,
  isWellFormedSourceHash,
} from '../../lib/guide-translation/source-hash';
import type { JsonBlock } from '../../types/json-guide.types';
import { SIDECAR_HASH_FUNCTIONS } from './hash';

const BLOCKS: JsonBlock[] = [
  { type: 'markdown', id: 'intro', content: 'Café ガイド' },
  {
    type: 'multistep',
    id: 'save',
    content: 'Save the dashboard.',
    steps: [{ id: 'open', action: 'button', reftarget: '#save', description: 'Open the save dialog.' }],
  },
  { type: 'quiz', id: 'check', question: 'Why?', choices: [{ id: 'a', text: 'Because' }] } as JsonBlock,
];

describe('sidecar hash functions', () => {
  it.each(BLOCKS.map((block) => [block.type, block] as const))(
    'hash a %s block as the canonical async hash does',
    async (_type, block) => {
      expect(SIDECAR_HASH_FUNCTIONS.block(block)).toBe(await hashBlockSource(block));
    }
  );

  it('returns well-formed hashes, and none for a block outside the projection table', () => {
    expect(isWellFormedSourceHash(SIDECAR_HASH_FUNCTIONS.block(BLOCKS[0]!))).toBe(true);
    expect(SIDECAR_HASH_FUNCTIONS.block(BLOCKS[2]!)).toBeUndefined();
  });

  it('hashes the manifest block as the canonical async hash does', async () => {
    const manifest = { description: 'Build a dashboard.', category: 'Dashboards' };
    expect(SIDECAR_HASH_FUNCTIONS.manifest(manifest)).toBe(await hashManifestSource(manifest));
  });

  it('hashes the guide title as the canonical async hash does', async () => {
    expect(SIDECAR_HASH_FUNCTIONS.guideTitle('Create your first dashboard')).toBe(
      await hashGuideTitleSource('Create your first dashboard')
    );
  });
});
