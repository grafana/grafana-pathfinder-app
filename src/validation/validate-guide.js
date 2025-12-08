'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.validateGuide = validateGuide;
exports.validateGuideFromString = validateGuideFromString;
exports.toLegacyResult = toLegacyResult;
const json_guide_schema_1 = require('../types/json-guide.schema');
const errors_1 = require('./errors');
const unknown_fields_1 = require('./unknown-fields');
function validateGuide(data, options = {}) {
  const result = json_guide_schema_1.JsonGuideSchema.safeParse(data);
  if (!result.success) {
    return {
      isValid: false,
      errors: (0, errors_1.formatZodErrors)(result.error.issues, data),
      warnings: [],
      guide: null,
    };
  }
  const warnings = options.skipUnknownFieldCheck ? [] : (0, unknown_fields_1.detectUnknownFields)(data);
  if (result.data.blocks.length === 0) {
    warnings.push({ message: 'Guide has no blocks', path: ['blocks'], type: 'suggestion' });
  }
  if (options.strict && warnings.length > 0) {
    return {
      isValid: false,
      errors: warnings.map((w) => ({ message: w.message, path: w.path, code: 'strict' })),
      warnings: [],
      guide: null,
    };
  }
  return { isValid: true, errors: [], warnings, guide: result.data };
}
function validateGuideFromString(jsonString, options = {}) {
  let parsed;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    return {
      isValid: false,
      errors: [{ message: 'The file does not contain valid JSON', path: [], code: 'invalid_json' }],
      warnings: [],
      guide: null,
    };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      isValid: false,
      errors: [{ message: 'JSON must be an object with id, title, and blocks', path: [], code: 'invalid_type' }],
      warnings: [],
      guide: null,
    };
  }
  return validateGuide(parsed, options);
}
function toLegacyResult(result) {
  return {
    isValid: result.isValid,
    errors: (0, errors_1.formatErrorsAsStrings)(result.errors),
    warnings: (0, errors_1.formatWarningsAsStrings)(result.warnings),
    guide: result.guide,
  };
}
