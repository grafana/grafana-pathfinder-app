'use strict';
/**
 * Validation Module
 *
 * Single source of truth for JSON guide validation using Zod schemas.
 *
 * @example
 * ```ts
 * import { validateGuide, validateGuideFromString } from '../validation';
 *
 * // Validate parsed JSON
 * const result = validateGuide(parsedData);
 *
 * // Validate JSON string
 * const result = validateGuideFromString(jsonString);
 *
 * // Strict mode (warnings become errors)
 * const result = validateGuide(data, { strict: true });
 * ```
 */
Object.defineProperty(exports, '__esModule', { value: true });
exports.detectUnknownFields =
  exports.formatWarningsAsStrings =
  exports.formatErrorsAsStrings =
  exports.formatZodErrors =
  exports.toLegacyResult =
  exports.validateGuideFromString =
  exports.validateGuide =
    void 0;
let validate_guide_1 = require('./validate-guide');
Object.defineProperty(exports, 'validateGuide', {
  enumerable: true,
  get: function () {
    return validate_guide_1.validateGuide;
  },
});
Object.defineProperty(exports, 'validateGuideFromString', {
  enumerable: true,
  get: function () {
    return validate_guide_1.validateGuideFromString;
  },
});
Object.defineProperty(exports, 'toLegacyResult', {
  enumerable: true,
  get: function () {
    return validate_guide_1.toLegacyResult;
  },
});
let errors_1 = require('./errors');
Object.defineProperty(exports, 'formatZodErrors', {
  enumerable: true,
  get: function () {
    return errors_1.formatZodErrors;
  },
});
Object.defineProperty(exports, 'formatErrorsAsStrings', {
  enumerable: true,
  get: function () {
    return errors_1.formatErrorsAsStrings;
  },
});
Object.defineProperty(exports, 'formatWarningsAsStrings', {
  enumerable: true,
  get: function () {
    return errors_1.formatWarningsAsStrings;
  },
});
let unknown_fields_1 = require('./unknown-fields');
Object.defineProperty(exports, 'detectUnknownFields', {
  enumerable: true,
  get: function () {
    return unknown_fields_1.detectUnknownFields;
  },
});
