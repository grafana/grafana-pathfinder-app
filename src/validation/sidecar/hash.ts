import { createHash } from 'crypto';

import {
  SOURCE_HASH_PREFIX,
  canonicalBlockSource,
  canonicalGuideTitleSource,
  canonicalManifestSource,
} from '../../lib/guide-translation/source-hash';
import type { SidecarHashFunctions } from './types';

function digest(serialized: string): string {
  return `${SOURCE_HASH_PREFIX}${createHash('sha256').update(serialized, 'utf8').digest('hex')}`;
}

/**
 * Serialization is `source-hash.ts`'s, so "what is hashed" has one definition;
 * only the digest is computed here, synchronously.
 */
export const SIDECAR_HASH_FUNCTIONS: SidecarHashFunctions = {
  block: (block) => {
    const serialized = canonicalBlockSource(block);
    return serialized === undefined ? undefined : digest(serialized);
  },
  manifest: (manifest) => digest(canonicalManifestSource(manifest)),
  guideTitle: (title) => digest(canonicalGuideTitleSource(title)),
};
