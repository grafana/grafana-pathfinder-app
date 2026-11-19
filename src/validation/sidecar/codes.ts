/**
 * Every code a sidecar finding can carry (docs/design/I18N.md §7.1, §9).
 *
 * The union is declared once, here, ahead of the checks that emit most of it,
 * so a check PR fills its stub and never edits this file, the registry or
 * `validate-package.ts`. Codes are stable strings: renaming one is a wire
 * break for every consumer that matches on it.
 *
 * `registry.test.ts` fails when a code here is not claimed by exactly one
 * check (or by the seam, for `SIDECAR_SEAM_CODES`), so the union cannot drift
 * from the checks.
 */

/** Emitted by the seam itself, for a sidecar file that could not be read. */
export const SIDECAR_SEAM_CODES = ['sidecar_unreadable'] as const;

/** `manifest-block-fields`: a key in the manifest block that is not translatable. */
export const MANIFEST_BLOCK_FIELDS_CODES = ['sidecar_manifest_block_field'] as const;

/** `orphan-key` (#2387): a sidecar key with no matching block or step id. Warnings. */
export const ORPHAN_KEY_CODES = ['sidecar_orphan_key', 'sidecar_orphan_step'] as const;

/** `source-hash` (#2388): a missing hash is an error; a mismatched one is a staleness warning. */
export const SOURCE_HASH_CODES = ['sidecar_missing_source_hash', 'sidecar_stale_translation'] as const;

/** `projection-conformance` (#2389): fields the projection table does not allow. */
export const PROJECTION_CONFORMANCE_CODES = [
  'sidecar_structural_field',
  'sidecar_field_not_translatable',
  'sidecar_block_type_not_translatable',
  'sidecar_steps_not_allowed',
  'sidecar_reserved_field',
] as const;

/** `text-dependent-selector` (#2390): `content.json` targets that only match English UI text. */
export const TEXT_DEPENDENT_SELECTOR_CODES = ['text_dependent_selector'] as const;

/** `translatable-ids` (#2391): blocks and steps a translation has nothing to attach to. */
export const TRANSLATABLE_IDS_CODES = [
  'translatable_block_missing_id',
  'translatable_step_missing_id',
  'duplicate_block_id',
  'duplicate_step_id',
] as const;

/** `language-tag` (#2392): file name and `language` tags, and hidden Unicode in translated text. */
export const LANGUAGE_TAG_CODES = [
  'sidecar_filename_invalid',
  'sidecar_language_invalid',
  'sidecar_language_filename_mismatch',
  'sidecar_language_is_canonical',
  'sidecar_unicode_format_character',
] as const;

export const SIDECAR_FINDING_CODES = [
  ...SIDECAR_SEAM_CODES,
  ...MANIFEST_BLOCK_FIELDS_CODES,
  ...ORPHAN_KEY_CODES,
  ...SOURCE_HASH_CODES,
  ...PROJECTION_CONFORMANCE_CODES,
  ...TEXT_DEPENDENT_SELECTOR_CODES,
  ...TRANSLATABLE_IDS_CODES,
  ...LANGUAGE_TAG_CODES,
] as const;

export type SidecarFindingCode = (typeof SIDECAR_FINDING_CODES)[number];
