/**
 * Per-prefix argument helpers used by `ConditionChipsField`.
 *
 * Each helper takes a `ConditionHelperProps` and renders a smarter
 * input than a plain text box for one specific parameterized prefix.
 * The mapping from prefix → helper component is exported as
 * `HELPER_BY_PREFIX`; prefixes with no entry fall back to a plain
 * `<Input>` inside the picker.
 */

import type React from 'react';
import { ParameterizedRequirementPrefix } from '../../../../types/requirements.types';
import type { ConditionHelperProps } from './types';
import { OnPageHelper } from './OnPageHelper';
import { HasDatasourceHelper } from './HasDatasourceHelper';
import { MinVersionHelper } from './MinVersionHelper';
import { VarHelper } from './VarHelper';

export type ConditionHelperComponent = React.ComponentType<ConditionHelperProps>;

export const HELPER_BY_PREFIX: Readonly<Record<string, ConditionHelperComponent>> = Object.freeze({
  [ParameterizedRequirementPrefix.ON_PAGE]: OnPageHelper,
  [ParameterizedRequirementPrefix.HAS_DATASOURCE]: HasDatasourceHelper,
  [ParameterizedRequirementPrefix.DATASOURCE_CONFIGURED]: HasDatasourceHelper,
  [ParameterizedRequirementPrefix.MIN_VERSION]: MinVersionHelper,
  [ParameterizedRequirementPrefix.VARIABLE]: VarHelper,
});

export type { ConditionHelperProps } from './types';
export { OnPageHelper, HasDatasourceHelper, MinVersionHelper, VarHelper };
