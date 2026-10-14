import { z } from 'zod';
import { ManifestJsonObjectSchema } from '../types/package.schema';

function normalizeRuntimePrerequisiteFormats(manifest: unknown): unknown {
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    return manifest;
  }

  const prerequisites = (manifest as Record<string, unknown>).prerequisites;
  if (!Array.isArray(prerequisites)) {
    return manifest;
  }

  return {
    ...manifest,
    prerequisites: prerequisites.map((prerequisite) => {
      if (typeof prerequisite !== 'object' || prerequisite === null || Array.isArray(prerequisite)) {
        return prerequisite;
      }
      const { format, ...literalPrerequisite } = prerequisite as Record<string, unknown>;
      return format === 'markdown' ? prerequisite : literalPrerequisite;
    }),
  };
}

export const RuntimeManifestJsonObjectSchema = z.preprocess(
  normalizeRuntimePrerequisiteFormats,
  ManifestJsonObjectSchema
);
