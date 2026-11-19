/**
 * Every v1 sidecar check, in the order its findings are reported
 * (docs/design/I18N.md §7.1, §9). Checks are independent of each other: the
 * order only fixes the output, so it is stable between runs.
 *
 * A stub is registered here before its check exists, so filling one means
 * editing its own file under `checks/` and nothing in this one.
 */

import { languageTagCheck } from './checks/language-tag';
import { manifestBlockFieldsCheck } from './checks/manifest-block-fields';
import { orphanKeyCheck } from './checks/orphan-key';
import { projectionConformanceCheck } from './checks/projection-conformance';
import { sourceHashCheck } from './checks/source-hash';
import { textDependentSelectorCheck } from './checks/text-dependent-selector';
import { translatableIdsCheck } from './checks/translatable-ids';
import type { SidecarCheck } from './types';

export const SIDECAR_CHECKS: readonly SidecarCheck[] = [
  languageTagCheck,
  manifestBlockFieldsCheck,
  projectionConformanceCheck,
  orphanKeyCheck,
  sourceHashCheck,
  translatableIdsCheck,
  textDependentSelectorCheck,
];
