import type { SidecarReadSuccess } from '../cli/utils/package-io';
import { PROJECTION_TABLE } from '../lib/guide-translation/projection-table';
import type { TranslationSidecar } from '../types/translation-sidecar.schema';
import { SIDECAR_HASH_FUNCTIONS } from '../validation/sidecar/hash';
import { sidecarFileLabel, type SidecarCheckContext } from '../validation/sidecar/types';

export function sidecarOf(tag: string, overrides: Partial<TranslationSidecar> = {}): SidecarReadSuccess {
  return {
    ok: true,
    tag,
    filePath: `/package/${sidecarFileLabel(tag)}`,
    sidecar: { schemaVersion: '1.0.0', language: tag, ...overrides },
  };
}

export function contextOf(
  sidecars: readonly SidecarReadSuccess[],
  overrides: Partial<SidecarCheckContext> = {}
): SidecarCheckContext {
  return {
    content: { id: 'guide', title: 'Guide', blocks: [{ type: 'markdown', id: 'intro', content: 'Hello' }] },
    manifest: undefined,
    sidecars,
    projection: PROJECTION_TABLE,
    hash: SIDECAR_HASH_FUNCTIONS,
    allowStaleTranslations: false,
    ...overrides,
  };
}
