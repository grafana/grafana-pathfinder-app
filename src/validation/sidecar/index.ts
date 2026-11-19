/**
 * The sidecar validation seam (docs/design/I18N.md §7.1, §9): the one place
 * `validatePackage` checks a package's `i18n/*.json` translation sidecars.
 *
 * Findings are routed by severity. An error goes to `errors`. A warning goes
 * to `messages` with `severity: 'warn'`, never to `warnings`, because
 * `validate --strict` promotes every entry in `warnings` to an error and
 * staleness and orphan keys must never fail a build (§6.8).
 */

import { PROJECTION_TABLE } from '../../lib/guide-translation/projection-table';
import type { SidecarReadFailure, SidecarReadResult, SidecarReadSuccess } from '../../cli/utils/package-io';
import { TRANSLATION_SIDECAR_DIR } from '../../types/translation-sidecar.schema';
import type { ContentJson, ManifestJson } from '../../types/package.types';
import type { ValidationError } from '../errors';
import { SIDECAR_HASH_FUNCTIONS } from './hash';
import { SIDECAR_CHECKS } from './registry';
import {
  sidecarFileLabel,
  type SidecarCheck,
  type SidecarCheckContext,
  type SidecarFinding,
  type SidecarWarningMessage,
} from './types';

export interface SidecarValidationInput {
  content: ContentJson;
  manifest: ManifestJson | undefined;
  /** From `readPackageSidecars`; empty when the package ships no `i18n/` files. */
  sidecars: readonly SidecarReadResult[];
}

export interface SidecarValidationOutput {
  errors: ValidationError[];
  messages: SidecarWarningMessage[];
}

const READ_FAILURE_MESSAGES: Record<SidecarReadFailure['code'], string> = {
  read_error: 'cannot be read',
  invalid_json: 'is not valid JSON',
  schema_validation: 'does not match the translation sidecar schema',
};

function unreadableSidecarErrors(failure: SidecarReadFailure): ValidationError[] {
  const file = failure.tag === undefined ? TRANSLATION_SIDECAR_DIR : sidecarFileLabel(failure.tag);
  if (failure.code === 'schema_validation' && failure.issues) {
    return failure.issues.map((issue) => ({
      message: `${file}: ${issue.message}`,
      path: [file, ...issue.path.map(String)],
      code: 'sidecar_unreadable',
    }));
  }
  return [{ message: `${file} ${READ_FAILURE_MESSAGES[failure.code]}`, path: [file], code: 'sidecar_unreadable' }];
}

function routeFinding(finding: SidecarFinding, output: SidecarValidationOutput): void {
  if (finding.severity === 'error') {
    const { message, path, code, remediation } = finding;
    output.errors.push(remediation === undefined ? { message, path, code } : { message, path, code, remediation });
    return;
  }
  output.messages.push({
    severity: 'warn',
    message: finding.message,
    path: finding.path,
    remediation: finding.remediation,
    code: finding.code,
  });
}

/**
 * Run every check over a package's sidecars. A sidecar that failed to read is
 * reported as an error and left out of the checks' context; the rest still run.
 * A package with no sidecars yields nothing, and no check runs.
 */
export function validateSidecars(
  input: SidecarValidationInput,
  checks: readonly SidecarCheck[] = SIDECAR_CHECKS
): SidecarValidationOutput {
  const output: SidecarValidationOutput = { errors: [], messages: [] };
  if (input.sidecars.length === 0) {
    return output;
  }

  const parsed: SidecarReadSuccess[] = [];
  for (const result of input.sidecars) {
    if (result.ok) {
      parsed.push(result);
    } else {
      output.errors.push(...unreadableSidecarErrors(result));
    }
  }

  const context: SidecarCheckContext = {
    content: input.content,
    manifest: input.manifest,
    sidecars: parsed,
    projection: PROJECTION_TABLE,
    hash: SIDECAR_HASH_FUNCTIONS,
  };
  for (const check of checks) {
    for (const finding of check.run(context)) {
      routeFinding(finding, output);
    }
  }
  return output;
}
