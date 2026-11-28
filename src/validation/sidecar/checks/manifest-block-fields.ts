import { TranslationManifestEntrySchema } from '../../../types/translation-sidecar.schema';
import { MANIFEST_BLOCK_FIELDS_CODES } from '../codes';
import { sidecarFileLabel, type SidecarCheck, type SidecarFinding } from '../types';

/**
 * Manifest fields that are structural, not display text (docs/design/I18N.md
 * §7.1). They get a sharper message than an unlisted key; both are errors.
 */
const STRUCTURAL_MANIFEST_FIELDS: ReadonlySet<string> = new Set([
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
]);

/**
 * Read from the schema, so a tooling field the review-validity mechanism adds
 * to `TranslationManifestEntrySchema` (#2381) is allowed without an edit here.
 */
const ALLOWED_MANIFEST_BLOCK_FIELDS: ReadonlySet<string> = new Set(Object.keys(TranslationManifestEntrySchema.shape));

const TRANSLATED_FIELDS = 'description and category';

/** The `manifest` block of a sidecar may carry `description` and `category` text and tooling fields only. */
export const manifestBlockFieldsCheck: SidecarCheck = {
  id: 'manifest-block-fields',
  codes: MANIFEST_BLOCK_FIELDS_CODES,
  run: ({ sidecars }) =>
    sidecars.flatMap(({ tag, sidecar }): SidecarFinding[] => {
      const file = sidecarFileLabel(tag);
      return Object.keys(sidecar.manifest ?? {})
        .filter((key) => !ALLOWED_MANIFEST_BLOCK_FIELDS.has(key))
        .map((key) => ({
          severity: 'error',
          code: 'sidecar_manifest_block_field',
          message: STRUCTURAL_MANIFEST_FIELDS.has(key)
            ? `${file}: manifest block field "${key}" is structural and cannot be translated; remove it (the manifest block carries only ${TRANSLATED_FIELDS})`
            : `${file}: manifest block field "${key}" is not translatable; remove it (the manifest block carries only ${TRANSLATED_FIELDS})`,
          path: [file, 'manifest', key],
        }));
    }),
};
