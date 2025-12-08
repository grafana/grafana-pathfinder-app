'use strict';
/**
 * Type-safe requirement definitions for compile-time checking
 * This prevents unknown requirement types from reaching runtime
 */
Object.defineProperty(exports, '__esModule', { value: true });
exports.isValidRequirement =
  exports.isParameterizedRequirement =
  exports.isFixedRequirement =
  exports.ParameterizedRequirementPrefix =
  exports.FixedRequirementType =
    void 0;
// Fixed requirement types (no parameters)
let FixedRequirementType;
(function (FixedRequirementType) {
  FixedRequirementType['EXISTS_REFTARGET'] = 'exists-reftarget';
  FixedRequirementType['NAVMENU_OPEN'] = 'navmenu-open';
  FixedRequirementType['HAS_DATASOURCES'] = 'has-datasources';
  FixedRequirementType['IS_ADMIN'] = 'is-admin';
  FixedRequirementType['IS_LOGGED_IN'] = 'is-logged-in';
  FixedRequirementType['IS_EDITOR'] = 'is-editor';
  FixedRequirementType['DASHBOARD_EXISTS'] = 'dashboard-exists';
  FixedRequirementType['FORM_VALID'] = 'form-valid';
})(FixedRequirementType || (exports.FixedRequirementType = FixedRequirementType = {}));
// Parameterized requirement prefixes
let ParameterizedRequirementPrefix;
(function (ParameterizedRequirementPrefix) {
  ParameterizedRequirementPrefix['HAS_PERMISSION'] = 'has-permission:';
  ParameterizedRequirementPrefix['HAS_ROLE'] = 'has-role:';
  ParameterizedRequirementPrefix['HAS_DATASOURCE'] = 'has-datasource:';
  ParameterizedRequirementPrefix['DATASOURCE_CONFIGURED'] = 'datasource-configured:';
  ParameterizedRequirementPrefix['HAS_PLUGIN'] = 'has-plugin:';
  ParameterizedRequirementPrefix['PLUGIN_ENABLED'] = 'plugin-enabled:';
  ParameterizedRequirementPrefix['HAS_DASHBOARD_NAMED'] = 'has-dashboard-named:';
  ParameterizedRequirementPrefix['ON_PAGE'] = 'on-page:';
  ParameterizedRequirementPrefix['HAS_FEATURE'] = 'has-feature:';
  ParameterizedRequirementPrefix['IN_ENVIRONMENT'] = 'in-environment:';
  ParameterizedRequirementPrefix['MIN_VERSION'] = 'min-version:';
  ParameterizedRequirementPrefix['SECTION_COMPLETED'] = 'section-completed:';
})(ParameterizedRequirementPrefix || (exports.ParameterizedRequirementPrefix = ParameterizedRequirementPrefix = {}));
// Helper functions for type checking
const isFixedRequirement = (req) => {
  return Object.values(FixedRequirementType).includes(req);
};
exports.isFixedRequirement = isFixedRequirement;
const isParameterizedRequirement = (req) => {
  return Object.values(ParameterizedRequirementPrefix).some((prefix) => req.startsWith(prefix));
};
exports.isParameterizedRequirement = isParameterizedRequirement;
const isValidRequirement = (req) => {
  return (0, exports.isFixedRequirement)(req) || (0, exports.isParameterizedRequirement)(req);
};
exports.isValidRequirement = isValidRequirement;
