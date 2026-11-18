/**
 * Zod schema for a translation sidecar, `i18n/<tag>.json` in a package
 * (docs/design/I18N.md §5.3, §7.1).
 *
 * The schema pins the file's shape only. Which fields a block entry may carry
 * is the projection table's business (`src/lib/guide-translation`), and each
 * rule is reported by a `validate` check with its own code, so entries stay
 * loose here: a check that sees the offending key can name it, where a schema
 * failure could not.
 */

import { z } from 'zod';

export const TRANSLATION_SIDECAR_SCHEMA_VERSION = '1.0.0';

/** Directory inside a package that holds the sidecars. */
export const TRANSLATION_SIDECAR_DIR = 'i18n';

const SourceHashSchema = z.string();

/**
 * A block entry: translated string fields keyed by field name, plus `steps`
 * for `multistep` and `guided`. Unknown keys parse whatever their value, so
 * the projection-conformance check can report a structural or
 * non-translatable field by name.
 */
export const TranslationBlockEntrySchema = z.looseObject({
  steps: z.record(z.string(), z.record(z.string(), z.string())).optional(),
  reviewed: z.boolean().optional(),
  _sourceHash: SourceHashSchema.optional(),
});

/**
 * The manifest's translatable display metadata (§6.9). Loose for the same
 * reason as a block entry: the `manifest-block-fields` check reports a
 * forbidden key such as `milestones` by name.
 */
export const TranslationManifestEntrySchema = z.looseObject({
  description: z.string().optional(),
  category: z.string().optional(),
  reviewed: z.boolean().optional(),
  _sourceHash: SourceHashSchema.optional(),
});

/**
 * The guide title, carried as its own entry so that it has a review mark and
 * a source hash like every other translatable unit (I18N.md §5.3, "Guide
 * title"). Strict: the entry has one translatable field and no check that
 * would report a stray key.
 */
export const TranslationGuideEntrySchema = z.strictObject({
  title: z.string().optional(),
  reviewed: z.boolean().optional(),
  _sourceHash: SourceHashSchema.optional(),
});

export const TranslationBaseRefSchema = z.strictObject({
  commit: z.string().min(1),
  path: z.string().min(1),
});

export const TranslationSidecarSchema = z.strictObject({
  schemaVersion: z.string().min(1),
  language: z.string().min(1),
  baseRef: TranslationBaseRefSchema.optional(),
  guide: TranslationGuideEntrySchema.optional(),
  manifest: TranslationManifestEntrySchema.optional(),
  blocks: z.record(z.string(), TranslationBlockEntrySchema).optional(),
  /** Availability latch, stamped by tooling only (§6.7). */
  _available: z.boolean().optional(),
});

export type TranslationBlockEntry = z.infer<typeof TranslationBlockEntrySchema>;
export type TranslationManifestEntry = z.infer<typeof TranslationManifestEntrySchema>;
export type TranslationGuideEntry = z.infer<typeof TranslationGuideEntrySchema>;
export type TranslationBaseRef = z.infer<typeof TranslationBaseRefSchema>;
export type TranslationSidecar = z.infer<typeof TranslationSidecarSchema>;

/** Any entry that carries a review mark. */
export type TranslationEntry = TranslationBlockEntry | TranslationManifestEntry | TranslationGuideEntry;
