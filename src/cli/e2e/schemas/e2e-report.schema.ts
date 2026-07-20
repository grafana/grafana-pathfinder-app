import { z } from 'zod';

export const E2E_REPORT_SCHEMA_VERSION = '1.0.0' as const;

export const E2E_REPORT_SCHEMA_ID =
  `https://grafana.com/schemas/pathfinder/e2e-test-report-${E2E_REPORT_SCHEMA_VERSION}.json` as const;
export const E2E_MULTI_REPORT_SCHEMA_ID =
  `https://grafana.com/schemas/pathfinder/e2e-multi-guide-report-${E2E_REPORT_SCHEMA_VERSION}.json` as const;

// ============================================
// Enum schemas
// ============================================

export const E2EExecutionOutcomeSchema = z.enum([
  'passed',
  'failed',
  'aborted',
  'skipped',
  'infrastructure_error',
  'configuration_error',
]);

export const E2EErrorCodeSchema = z.enum([
  'AUTH_EXPIRED',
  'MANDATORY_FAILURE',
  'SKIPPED_PREREQ',
  'PROVISIONING_FAILED',
  'GRAFANA_UNREACHABLE',
  'CONFIGURATION_ERROR',
  'PLAYWRIGHT_SPAWN_FAILED',
  'NO_CAPACITY',
  'REPORT_MISSING',
  'UNKNOWN',
]);

export const ErrorClassificationSchema = z.enum(['content-drift', 'product-regression', 'infrastructure', 'unknown']);

// ============================================
// Shared sub-schemas
// ============================================

const SideEffectLevelSchema = z.enum(['readonly', 'possibly_mutating', 'mutating', 'unknown']);

const SideEffectClassificationSchema = z.object({
  level: SideEffectLevelSchema,
  reasons: z.array(
    z.object({
      level: z.enum(['possibly_mutating', 'mutating', 'unknown']),
      path: z.string(),
      message: z.string(),
    })
  ),
});

const AbortReasonSchema = z.enum(['AUTH_EXPIRED', 'MANDATORY_FAILURE', 'SKIPPED_PREREQ', 'PROVISIONING_FAILED']);

// ============================================
// Report component schemas
// ============================================

export const RunnerProvenanceSchema = z.object({
  name: z.literal('pathfinder-e2e-runner'),
  version: z.string(),
  nodeVersion: z.string(),
  playwrightVersion: z.string(),
  image: z.string().optional(),
});

export const ReportTargetSchema = z.object({
  url: z.string(),
  tier: z.string().optional(),
  instance: z.string().optional(),
});

export const ReportSummarySchema = z.object({
  total: z.number(),
  passed: z.number(),
  failed: z.number(),
  skipped: z.number(),
  notReached: z.number(),
  duration: z.number(),
  mandatoryFailed: z.number(),
  skippableFailed: z.number(),
});

export const ArtifactPathsSchema = z.object({
  screenshot: z.string().optional(),
  screenshotPre: z.string().optional(),
  dom: z.string().optional(),
  console: z.string().optional(),
});

export const ReportStepResultSchema = z.object({
  stepId: z.string(),
  index: z.number(),
  status: z.enum(['passed', 'failed', 'skipped', 'not_reached']),
  duration: z.number(),
  currentUrl: z.string(),
  consoleErrors: z.array(z.string()),
  skipReason: z.string().optional(),
  error: z.string().optional(),
  skippable: z.boolean().optional(),
  classification: ErrorClassificationSchema.optional(),
  artifacts: ArtifactPathsSchema.optional(),
});

export const GuideMetadataSchema = z.object({
  id: z.string(),
  title: z.string(),
  path: z.string(),
  packageId: z.string().optional(),
  tier: z.string().optional(),
  instance: z.string().optional(),
  targetUrl: z.string().optional(),
  sourceUrl: z.string().optional(),
  contentDigest: z.string().optional(),
  sideEffects: SideEffectClassificationSchema.optional(),
});

export const ReportConfigSchema = z.object({
  grafanaVersion: z.string().optional(),
  timestamp: z.string(),
});

export const PreRunSkipSchema = z.object({
  id: z.string(),
  reason: z.string(),
  message: z.string(),
  failed: z.boolean(),
  tier: z.string().optional(),
  sourceUrl: z.string().optional(),
  sideEffects: SideEffectClassificationSchema.optional(),
});

// ============================================
// Top-level report schemas
// ============================================

export const E2ETestReportSchema = z
  .object({
    schemaVersion: z.literal(E2E_REPORT_SCHEMA_VERSION),
    outcome: E2EExecutionOutcomeSchema,
    errorCode: E2EErrorCodeSchema.optional(),
    errorMessage: z.string().optional(),
    runner: RunnerProvenanceSchema,
    startedAt: z.string(),
    endedAt: z.string(),
    target: ReportTargetSchema,
    guide: GuideMetadataSchema,
    config: ReportConfigSchema,
    summary: ReportSummarySchema,
    steps: z.array(ReportStepResultSchema),
    aborted: z.boolean().optional(),
    abortReason: AbortReasonSchema.optional(),
    abortMessage: z.string().optional(),
    preRunSkipped: z.array(PreRunSkipSchema).optional(),
    cleanupWarnings: z.array(z.string()).optional(),
  })
  .meta({ title: 'Pathfinder E2E test report' });

export const GuideResultSchema = z.object({
  id: z.string(),
  title: z.string(),
  path: z.string(),
  success: z.boolean(),
  abortReason: AbortReasonSchema.optional(),
  summary: ReportSummarySchema,
  duration: z.number(),
  sideEffects: SideEffectClassificationSchema.optional(),
});

export const MultiGuideSummarySchema = z.object({
  totalGuides: z.number(),
  passedGuides: z.number(),
  failedGuides: z.number(),
  authExpiredGuides: z.number(),
  skippedGuides: z.number(),
  steps: z.object({
    total: z.number(),
    passed: z.number(),
    failed: z.number(),
    skipped: z.number(),
    notReached: z.number(),
    mandatoryFailed: z.number(),
    skippableFailed: z.number(),
  }),
  totalDuration: z.number(),
});

export const MultiGuideReportSchema = z
  .object({
    schemaVersion: z.literal(E2E_REPORT_SCHEMA_VERSION),
    outcome: E2EExecutionOutcomeSchema,
    runner: RunnerProvenanceSchema,
    startedAt: z.string(),
    endedAt: z.string(),
    type: z.literal('multi-guide'),
    config: ReportConfigSchema,
    summary: MultiGuideSummarySchema,
    guides: z.array(GuideResultSchema),
    reports: z.array(E2ETestReportSchema),
    preRunSkipped: z.array(PreRunSkipSchema).optional(),
    cleanupWarnings: z.array(z.string()).optional(),
  })
  .meta({
    id: E2E_MULTI_REPORT_SCHEMA_ID,
    title: 'Pathfinder E2E multi-guide test report',
  });

// ============================================
// Exported types (derived from Zod schemas)
// ============================================

export type E2EExecutionOutcome = z.infer<typeof E2EExecutionOutcomeSchema>;
export type E2EErrorCode = z.infer<typeof E2EErrorCodeSchema>;
export type ErrorClassification = z.infer<typeof ErrorClassificationSchema>;
export type RunnerProvenance = z.infer<typeof RunnerProvenanceSchema>;
export type ReportTarget = z.infer<typeof ReportTargetSchema>;
export type ReportSummary = z.infer<typeof ReportSummarySchema>;
export type ArtifactPaths = z.infer<typeof ArtifactPathsSchema>;
export type ReportStepResult = z.infer<typeof ReportStepResultSchema>;
export type GuideMetadata = z.infer<typeof GuideMetadataSchema>;
export type ReportConfig = z.infer<typeof ReportConfigSchema>;
export type PreRunSkip = z.infer<typeof PreRunSkipSchema>;
export type E2ETestReport = z.infer<typeof E2ETestReportSchema>;
export type GuideResult = z.infer<typeof GuideResultSchema>;
export type MultiGuideSummary = z.infer<typeof MultiGuideSummarySchema>;
export type MultiGuideReport = z.infer<typeof MultiGuideReportSchema>;
