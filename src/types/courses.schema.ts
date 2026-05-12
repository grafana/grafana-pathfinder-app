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

export const CourseSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  guides: z.array(z.string()),
  badgeId: z.string().min(1),
  targetPlatform: z.enum(['oss', 'cloud']).optional(),
  estimatedMinutes: z.number().optional(),
  icon: z.string().optional(),
  url: SafeUrlSchema.optional(),
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
    guides: z.array(z.string()),
    guideMetadata: z.record(z.string(), GuideMetadataEntrySchema).optional(),
    badgeId: z.string().min(1),
    targetPlatform: z.enum(['oss', 'cloud']).optional(),
    estimatedMinutes: z.number().optional(),
    icon: z.string().optional(),
    url: SafeUrlSchema.optional(),
  })
  .loose();

export const BadgeDocumentSchema = z
  .object({
    schemaVersion: z.string(),
    badge: BadgeSchema,
  })
  .loose();

export type InferredCoursesPlatformIndex = z.infer<typeof CoursesPlatformIndexSchema>;
export type InferredCourseDocument = z.infer<typeof CourseDocumentSchema>;
export type InferredBadgeDocument = z.infer<typeof BadgeDocumentSchema>;
