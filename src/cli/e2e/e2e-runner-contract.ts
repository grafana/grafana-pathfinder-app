import { z } from 'zod';

/**
 * Contract between the `pathfinder-cli e2e` command and the Playwright guide
 * runner it spawns. The CLI (`src/cli/commands/e2e.ts`) sets these environment
 * variables. Both runner specs and their Playwright config read them.
 *
 * Both sides must reference these constants rather than literal strings so a
 * rename can never silently break the cross-process protocol.
 */

/**
 * Environment-variable keys exchanged between the CLI and the Playwright runner.
 * The property name is the role; the value is the wire key placed in `env`.
 */
export const E2E_ENV = {
  /** Absolute path to the guide JSON the runner should load. */
  GUIDE_JSON_PATH: 'GUIDE_JSON_PATH',
  /** Absolute path to the validated shared-chain input JSON. */
  CHAIN_INPUT_PATH: 'E2E_CHAIN_INPUT_PATH',
  /** Grafana base URL under test. */
  GRAFANA_URL: 'GRAFANA_URL',
  /** Same-origin path where the guide should begin. */
  STARTING_LOCATION: 'STARTING_LOCATION',
  /**
   * Absolute path the form-login auth setup writes storage state to, and the
   * test project reads in non-token mode. Per-guide and ephemeral.
   */
  AUTH_STATE_FILE: 'AUTH_STATE_FILE',
  /** Username used by form-login auth setup. Defaults to admin. Not used in token mode. */
  GRAFANA_USER: 'GRAFANA_USER',
  /** Password used by form-login auth setup. Defaults to admin. Not used in token mode. */
  GRAFANA_PASSWORD: 'GRAFANA_PASSWORD',
  /**
   * Opaque Bearer credential for the Grafana target origin. When set, the
   * runner adds it only to same-origin requests and skips form-login auth.
   */
  GRAFANA_TOKEN: 'GRAFANA_TOKEN',
  /** Flag: enable Playwright tracing. */
  TRACE: 'E2E_TRACE',
  /** Flag: enable verbose runner and reporter output. */
  VERBOSE: 'E2E_VERBOSE',
  /** Absolute path the runner writes its abort reason to (e.g. session expiry). */
  ABORT_FILE_PATH: 'ABORT_FILE_PATH',
  /** Absolute path the runner writes step results to for JSON reporting. */
  RESULTS_FILE_PATH: 'RESULTS_FILE_PATH',
  /** Absolute path the shared runner writes its ordered milestone results to. */
  CHAIN_RESULTS_FILE_PATH: 'E2E_CHAIN_RESULTS_FILE_PATH',
  /** Directory the runner collects artifacts (screenshots, etc.) into. */
  ARTIFACTS_DIR: 'ARTIFACTS_DIR',
  /** Flag: capture screenshots on success as well as failure. */
  ALWAYS_SCREENSHOT: 'ALWAYS_SCREENSHOT',
  /**
   * Absolute path the runner writes the produced trace's location to, so the CLI
   * can surface it without hardcoding Playwright's per-test output-dir naming.
   */
  TRACE_OUTPUT_FILE: 'E2E_TRACE_OUTPUT_FILE',
} as const;

const ChainIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);

const ChainSideEffectsSchema = z
  .object({
    level: z.enum(['readonly', 'possibly_mutating', 'mutating', 'unknown']),
    reasons: z.array(
      z.object({
        level: z.enum(['possibly_mutating', 'mutating', 'unknown']),
        path: z.string(),
        message: z.string(),
      })
    ),
  })
  .strict();

export const E2EChainPackageMetadataSchema = z
  .object({
    packageId: z.string(),
    tier: z.string().optional(),
    instance: z.string().optional(),
    targetUrl: z.string().optional(),
    sourceUrl: z.string().optional(),
    startingLocation: z.string().optional(),
    sideEffects: ChainSideEffectsSchema.optional(),
  })
  .strict();

export const E2EChainGuideSchema = z
  .object({
    id: ChainIdSchema,
    path: z.string().min(1),
    content: z.string().min(1),
    dependencies: z.array(ChainIdSchema),
    authoredStartingLocation: z.string().optional(),
    packageMetadata: E2EChainPackageMetadataSchema.optional(),
  })
  .strict();

export const E2EChainInputSchema = z
  .object({
    targetUrl: z.url().refine((value) => {
      const protocol = new URL(value).protocol;
      return protocol === 'http:' || protocol === 'https:';
    }, 'Target URL protocol must be HTTP or HTTPS'),
    options: z
      .object({
        artifactsDir: z.string().min(1),
        alwaysScreenshot: z.boolean(),
        verbose: z.boolean(),
      })
      .strict(),
    guides: z.array(E2EChainGuideSchema).min(1).max(1000),
  })
  .strict()
  .superRefine((input, context) => {
    const ids = new Set<string>();
    for (const [index, guide] of input.guides.entries()) {
      if (ids.has(guide.id)) {
        context.addIssue({
          code: 'custom',
          path: ['guides', index, 'id'],
          message: `Duplicate guide ID: ${guide.id}`,
        });
      }
      ids.add(guide.id);
      if (guide.dependencies.includes(guide.id)) {
        context.addIssue({
          code: 'custom',
          path: ['guides', index, 'dependencies'],
          message: `Guide ${guide.id} cannot depend on itself`,
        });
      }
    }
    for (const [index, guide] of input.guides.entries()) {
      for (const dependency of guide.dependencies) {
        if (!ids.has(dependency)) {
          context.addIssue({
            code: 'custom',
            path: ['guides', index, 'dependencies'],
            message: `Guide ${guide.id} has an unresolved dependency: ${dependency}`,
          });
        }
      }
    }
  });

export type E2EChainPackageMetadata = z.infer<typeof E2EChainPackageMetadataSchema>;
export type E2EChainGuide = z.infer<typeof E2EChainGuideSchema>;
export type E2EChainInput = z.infer<typeof E2EChainInputSchema>;

export function parseE2EChainInput(input: unknown): E2EChainInput {
  return E2EChainInputSchema.parse(input);
}

/** Encode a boolean for transport through a string environment variable. */
export function encodeEnvFlag(value: boolean): string {
  return value ? 'true' : 'false';
}

/** Decode an environment-variable flag written by {@link encodeEnvFlag}. */
export function isEnvFlagEnabled(value: string | undefined): boolean {
  return value === 'true';
}
