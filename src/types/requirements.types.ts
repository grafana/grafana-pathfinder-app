/**
 * Type-safe requirement definitions for compile-time checking
 * This prevents unknown requirement types from reaching runtime
 */

// Fixed requirement types (no parameters)
export enum FixedRequirementType {
  EXISTS_REFTARGET = 'exists-reftarget',
  NAVMENU_OPEN = 'navmenu-open',
  HAS_DATASOURCES = 'has-datasources',
  IS_ADMIN = 'is-admin',
  IS_LOGGED_IN = 'is-logged-in',
  IS_EDITOR = 'is-editor',
  DASHBOARD_EXISTS = 'dashboard-exists',
  FORM_VALID = 'form-valid',
}

// Parameterized requirement prefixes
export enum ParameterizedRequirementPrefix {
  HAS_PERMISSION = 'has-permission:',
  HAS_ROLE = 'has-role:',
  HAS_DATASOURCE = 'has-datasource:',
  DATASOURCE_CONFIGURED = 'datasource-configured:',
  HAS_PLUGIN = 'has-plugin:',
  PLUGIN_ENABLED = 'plugin-enabled:',
  HAS_DASHBOARD_NAMED = 'has-dashboard-named:',
  ON_PAGE = 'on-page:',
  HAS_FEATURE = 'has-feature:',
  IN_ENVIRONMENT = 'in-environment:',
  MIN_VERSION = 'min-version:',
  SECTION_COMPLETED = 'section-completed:',
  /** Guide response variable check (e.g., var-policyAccepted:true) */
  VARIABLE = 'var-',
  /** Renderer context check (e.g., renderer:pathfinder, renderer:website) */
  RENDERER = 'renderer:',
}

// Helper type for parameterized requirements
export type ParameterizedRequirement = `${ParameterizedRequirementPrefix}${string}`;

// Union type for all valid requirements
export type ValidRequirement = FixedRequirementType | ParameterizedRequirement;

// Helper functions for type checking
export const isFixedRequirement = (req: string): req is FixedRequirementType => {
  return Object.values(FixedRequirementType).includes(req as FixedRequirementType);
};

export const isParameterizedRequirement = (req: string): req is ParameterizedRequirement => {
  return Object.values(ParameterizedRequirementPrefix).some((prefix) => req.startsWith(prefix));
};

export const isValidRequirement = (req: string): req is ValidRequirement => {
  return isFixedRequirement(req) || isParameterizedRequirement(req);
};

// Type-safe requirement checker options
export interface TypeSafeRequirementsCheckOptions {
  requirements: string; // We keep this as string for backward compatibility, but validate at runtime
  targetAction?: string;
  refTarget?: string;
  targetValue?: string;
  stepId?: string;
}
