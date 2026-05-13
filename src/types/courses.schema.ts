/**
 * Zod schemas for course wire types.
 *
 * Use `.loose()` on roots so older plugin versions can load newer CDN
 * payloads that add fields. Adding required fields is a breaking change
 * and requires a `schemaVersion` bump plus coordinated rollout.
 */

import { z } from 'zod';

export const COURSES_SCHEMA_VERSION = '1.0.0';

const SafeUrlSchema = z
  .string()
  .min(1)
  .refine(
    (url) => {
      try {
        const parsed = new URL(url);
        return ['http:', 'https:'].includes(parsed.protocol);
      } catch {
        return false;
      }
    },
    { error: 'URL must be absolute and use http or https' }
  );

const GuideMetadataEntrySchema = z.object({
  title: z.string(),
  estimatedMinutes: z.number(),
  url: SafeUrlSchema.optional(),
});

/**
 * A guide entry is either a bare package ID (no URL scheme) or an absolute
 * http(s) URL. Anything that looks URL-shaped must pass SafeUrlSchema so
 * `javascript:`, `data:`, etc. can't slip into the CDN payload.
 */
const GuideEntrySchema = z
  .string()
  .min(1)
  .refine(
    (entry) => {
      if (!/^\w+:/.test(entry)) {
        return true;
      }
      return SafeUrlSchema.safeParse(entry).success;
    },
    { error: 'Guide entry must be a bare ID or an absolute http(s) URL' }
  );

export const CourseSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  /**
   * Each entry is either a package ID (resolved via the package-engine chain)
   * or an absolute http(s) URL (rendered as an external-link guide).
   * Distinguished at runtime by `entry.startsWith('http')`.
   */
  guides: z.array(GuideEntrySchema),
  badgeId: z.string().min(1),
  targetPlatform: z.enum(['oss', 'cloud']).optional(),
  estimatedMinutes: z.number().optional(),
  icon: z.string().optional(),
});

export const BadgeTriggerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('guide-completed'), guideId: z.string().optional() }),
  z.object({ type: z.literal('path-completed'), pathId: z.string() }),
  z.object({ type: z.literal('streak'), days: z.number() }),
]);

export const BadgeSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  icon: z.string(),
  emoji: z.string().optional(),
  trigger: BadgeTriggerSchema,
});

export const CoursesPlatformIndexSchema = z
  .object({
    schemaVersion: z.string(),
    platform: z.enum(['oss', 'cloud']),
    generatedAt: z.string().optional(),
    courses: z.array(CourseSchema),
    guideMetadata: z.record(z.string(), GuideMetadataEntrySchema),
    badges: z.array(BadgeSchema),
  })
  .loose();

export const CourseDocumentSchema = z
  .object({
    schemaVersion: z.string(),
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string(),
    guides: z.array(GuideEntrySchema),
    guideMetadata: z.record(z.string(), GuideMetadataEntrySchema).optional(),
    badgeId: z.string().min(1),
    targetPlatform: z.enum(['oss', 'cloud']).optional(),
    estimatedMinutes: z.number().optional(),
    icon: z.string().optional(),
  })
  .loose();

export const BadgesDocumentSchema = z
  .object({
    schemaVersion: z.string(),
    badges: z.array(BadgeSchema),
  })
  .loose();

export type InferredCoursesPlatformIndex = z.infer<typeof CoursesPlatformIndexSchema>;
export type InferredCourseDocument = z.infer<typeof CourseDocumentSchema>;
export type InferredBadgesDocument = z.infer<typeof BadgesDocumentSchema>;
