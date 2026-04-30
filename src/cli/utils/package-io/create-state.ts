/**
 * `newPackageState` — build a fresh `PackageState` for the `create` command.
 * Stamped with `CURRENT_SCHEMA_VERSION` on both files so the resulting
 * package is tagged with the CLI version that produced it.
 */

import { CURRENT_SCHEMA_VERSION } from '../../../types/json-guide.schema';
import { ManifestJsonSchema } from '../../../types/package.schema';
import type { ContentJson, ManifestJson } from '../../../types/package.types';
import type { PackageState } from './disk';

export function newPackageState(args: {
  id: string;
  title: string;
  type: 'guide' | 'path' | 'journey';
  description?: string;
}): PackageState {
  const content: ContentJson = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: args.id,
    title: args.title,
    blocks: [],
  };

  // We could pass through ManifestJsonObjectSchema.parse() to fill in the
  // defaults explicitly, but doing so on construction means the on-disk file
  // has every field rather than relying on schema defaults at read-time —
  // which is the more defensible long-term shape (round-trips deterministic).
  const manifest = ManifestJsonSchema.parse({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: args.id,
    type: args.type,
    description: args.description,
  }) as ManifestJson;

  // `create` writes schemaVersion explicitly, so a freshly-created package
  // is "authored" for the drift check.
  return { content, manifest, manifestSchemaVersionAuthored: true };
}
