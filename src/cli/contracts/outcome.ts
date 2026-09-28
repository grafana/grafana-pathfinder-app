/**
 * Zod failures as command outcomes.
 *
 * Both adapters land on `schema.safeParse`, so both report failures in the same
 * vocabulary — parameter names rather than flag strings, matching what
 * `pathfinder_help` publishes.
 */

import type { z } from 'zod';

import type { ErrorOutcome } from '../utils/output';
import { resolveParamPolicy } from './policy';
import type { CommandSpec } from './spec';

/** `issue.path` rendered as a parameter reference an agent can act on. */
function issuePath(path: readonly PropertyKey[]): string {
  return path.length === 0 ? '(input)' : path.map((segment) => String(segment)).join('.');
}

function formatIssue(issue: z.core.$ZodIssue): string {
  return `${issuePath(issue.path)}: ${issue.message}`;
}

/**
 * Does this issue mean "you did not supply this parameter"? Decided from the input,
 * because Zod exposes no stable "was missing" marker distinct from "was the wrong
 * type", and absence is what the input can answer directly.
 */
function isAbsence(issue: z.core.$ZodIssue, raw: Record<string, unknown> | undefined): boolean {
  if (issue.code !== 'invalid_type' || issue.path.length !== 1) {
    return false;
  }
  return raw === undefined || raw[String(issue.path[0])] === undefined;
}

/**
 * What a missing parameter declared about being missing, if anything. It wins over
 * the generic code and message even when there are other problems, so a published
 * code means the same thing whichever surface noticed it; `data.issues` still
 * reports every problem.
 */
function declaredAbsence(
  spec: CommandSpec,
  issues: readonly z.core.$ZodIssue[],
  raw: Record<string, unknown> | undefined
): { code?: string; message?: string } {
  const shape = spec.schema.shape as Record<string, z.ZodType>;
  for (const issue of issues) {
    if (!isAbsence(issue, raw)) {
      continue;
    }
    const name = String(issue.path[0]);
    const policy = shape[name] ? resolveParamPolicy(shape[name]!) : undefined;
    if (policy?.missingCode || policy?.missingMessage) {
      return {
        ...(policy.missingCode ? { code: policy.missingCode } : {}),
        // Left in parameter references; the surface printing it spells them.
        ...(policy.missingMessage ? { message: policy.missingMessage } : {}),
      };
    }
  }
  return {};
}

/**
 * Render a parse failure as a command outcome, reporting every issue rather than the
 * first. Commander short-circuits on the first missing mandatory option, which the
 * schema-based approach avoids.
 */
export function outcomeFromZodError(spec: CommandSpec, error: z.ZodError, raw?: Record<string, unknown>): ErrorOutcome {
  const issues = error.issues;
  const rendered = issues.map(formatIssue);
  const declared = declaredAbsence(spec, issues, raw);

  return {
    status: 'error',
    code: declared.code ?? 'SCHEMA_VALIDATION',
    message:
      declared.message ??
      (issues.length === 1
        ? `${spec.name}: ${rendered[0]}`
        : `${spec.name}: ${issues.length} problems — ${rendered.join('; ')}`),
    data: {
      issues: issues.map((issue) => ({
        path: issuePath(issue.path),
        code: issue.code,
        message: issue.message,
      })),
    },
  };
}
