/**
 * Command contracts.
 *
 * A command's Zod schema is the sole authority for its input shape. Commander
 * and the MCP surface are renderers over it, differing only in pre-processing.
 */

export { PARAM_ROLES, readParamPolicy, resolveParamPolicy } from './policy';
export type { DeclaredPolicy, ParamPolicy, ParamRole } from './policy';

export { defineCommand, specFields } from './spec';
export type { CommandSpec, SpecField } from './spec';

export {
  CLI_VIEW,
  collectCommanderInput,
  mountCommander,
  mountCommanderGroup,
  parseCommandInput,
  readOutputOptions,
} from './render-commander';
export type { CommanderPresentation } from './render-commander';
export { patchShape, pickContent, pickSupplied, required, shapeKeys, withPolicy, type CommandShape } from './compose';
export {
  defineCommandGroup,
  renderGroupInterface,
  requiredByVariant,
  variantNames,
  type CommandGroupSpec,
} from './group';
export {
  carriesRequirementTokens,
  describeFor,
  publishedNames,
  renderInterface,
  requiredNames,
  REQUIREMENT_TOKEN_EXAMPLES,
  type SurfaceView,
} from './render-interface';
export { outcomeFromZodError } from './outcome';
