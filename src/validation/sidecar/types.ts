/**
 * The contract between the sidecar validation seam and its checks
 * (docs/design/I18N.md §7.1, §9). A check is a pure function of
 * `SidecarCheckContext`; it never touches the disk and never throws for bad
 * input, so every check is unit-testable with an in-memory context.
 */

import type { SidecarReadSuccess } from '../../cli/utils/package-io';
import type { PROJECTION_TABLE } from '../../lib/guide-translation/projection-table';
import type { JsonBlock } from '../../types/json-guide.types';
import type { ContentJson, ManifestJson } from '../../types/package.types';
import { TRANSLATION_SIDECAR_DIR } from '../../types/translation-sidecar.schema';
import type { SidecarFindingCode } from './codes';

/**
 * Synchronous source hashes, matching `lib/guide-translation/source-hash.ts`
 * byte for byte (`hash.test.ts` holds them to it). `validatePackage` is
 * synchronous, so a check cannot await the Web Crypto digest that file uses.
 */
export interface SidecarHashFunctions {
  /** `undefined` for a block type outside the projection table. */
  block(block: JsonBlock): string | undefined;
  manifest(manifest: { description?: unknown; category?: unknown }): string;
  guideTitle(title: string): string;
}

export interface SidecarCheckContext {
  readonly content: ContentJson;
  /** `undefined` when the package has no `manifest.json`, or it failed validation. */
  readonly manifest: ManifestJson | undefined;
  /** Sidecars that parsed, sorted by tag. Unreadable ones are reported by the seam. */
  readonly sidecars: readonly SidecarReadSuccess[];
  readonly projection: typeof PROJECTION_TABLE;
  readonly hash: SidecarHashFunctions;
}

/**
 * An error blocks validation. A warning does not, even under `--strict`, so
 * it must tell the author what to run (§6.8): the type requires a remediation.
 */
export type SidecarFinding =
  | {
      severity: 'error';
      code: SidecarFindingCode;
      message: string;
      /** Starts with the file the finding is about, e.g. `i18n/ja.json`. */
      path: string[];
      remediation?: string;
    }
  | {
      severity: 'warn';
      code: SidecarFindingCode;
      message: string;
      path: string[];
      remediation: string;
    };

/** A warning as `validatePackage` reports it in `messages`; assignable to `PackageValidationMessage`. */
export interface SidecarWarningMessage {
  severity: 'warn';
  message: string;
  path: string[];
  remediation: string;
  code: SidecarFindingCode;
}

export interface SidecarCheck {
  /** Matches the file name under `checks/`. */
  readonly id: string;
  /** The issue that owns the check while it is a stub; absent once it ships. */
  readonly pendingIssue?: string;
  /** Every code the check may emit. `registry.test.ts` holds this against the code union. */
  readonly codes: readonly SidecarFindingCode[];
  readonly run: (context: SidecarCheckContext) => SidecarFinding[];
}

/** The path root every finding about a sidecar starts with: `i18n/<tag>.json`. */
export function sidecarFileLabel(tag: string): string {
  return `${TRANSLATION_SIDECAR_DIR}/${tag}.json`;
}
