/**
 * Guide Validation Module
 */
import type { JsonGuide } from '../types/json-guide.types';
import { JsonGuideSchema } from '../types/json-guide.schema';
import {
  formatPath,
  formatZodErrors,
  formatErrorsAsStrings,
  formatWarningsAsStrings,
  type ValidationError,
  type ValidationWarning,
} from './errors';
import { detectUnknownFields } from './unknown-fields';
import { validateBlockConditions, type ConditionIssue } from './condition-validator';
import { customErrorMap } from './error-map';
import { normalizeJsonGuideAliases } from './normalize-guide-aliases';
import { validateSnippetReferences } from './snippet-references';

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  guide: JsonGuide | null;
}

export interface LegacyValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  guide: JsonGuide | null;
}

export interface ValidationOptions {
  strict?: boolean;
  skipUnknownFieldCheck?: boolean;
  snippetCatalogIds?: ReadonlySet<string>;
  /**
   * When true, a leading heading in blocks[0] that duplicates the guide title
   * stays a warning instead of failing validation. Runtime guide loaders set
   * this so an already-published guide keeps rendering; authoring gates (the
   * CLI `validate` command, the block editor) leave it unset so the error
   * blocks before the guide ships.
   */
  allowDuplicateHeading?: boolean;
}
/**
 * Convert a condition issue to a validation warning.
 */
function conditionIssueToWarning(issue: ConditionIssue): ValidationWarning {
  return {
    message: `${formatPath(issue.path)}: ${issue.message}`,
    path: issue.path,
    type: 'invalid-condition',
  };
}

function extractLeadingH1(markdown: string): string | null {
  const firstLine = markdown.trim().split('\n')[0] ?? '';
  const match = firstLine.match(/^#\s+(.+)$/);
  return match ? match[1]!.trim() : null;
}

function normalizeHeadingWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[!?.,:;'"()]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function headingDuplicatesTitle(headingText: string, title: string): boolean {
  const headingWords = normalizeHeadingWords(headingText);
  const titleWords = normalizeHeadingWords(title);
  if (headingWords.length === 0 || titleWords.length === 0) {
    return false;
  }
  const [shorter, longer] =
    headingWords.length <= titleWords.length ? [headingWords, titleWords] : [titleWords, headingWords];
  return shorter.every((word, i) => word === longer[i]);
}

export function validateGuide(data: unknown, options: ValidationOptions = {}): ValidationResult {
  // Normalize camelCase aliases before both the schema and the unknown-field check.
  const normalized = normalizeJsonGuideAliases(data);

  // 1. Zod parse - validates structure, types, nesting depth and use a custom error map for better messages
  const result = JsonGuideSchema.safeParse(normalized, { error: customErrorMap });

  if (!result.success) {
    return { isValid: false, errors: formatZodErrors(result.error.issues), warnings: [], guide: null };
  }

  // 2. Unknown fields check (existing) - single traversal
  const warnings: ValidationWarning[] = options.skipUnknownFieldCheck ? [] : detectUnknownFields(normalized);

  // 3. Condition validation (NEW) - only runs after Zod validates structure
  const conditionIssues = validateBlockConditions(result.data as JsonGuide);
  warnings.push(...conditionIssues.map(conditionIssueToWarning));

  // 4. Additional suggestions
  if (result.data.blocks.length === 0) {
    warnings.push({ message: 'Guide has no blocks', path: ['blocks'], type: 'suggestion' });
  }

  // A leading heading in blocks[0] that duplicates the guide title renders as a
  // second, redundant <h1> wherever the title is rendered separately — see
  // `allowDuplicateHeading` above.
  const advisories: ValidationWarning[] = [];
  const firstBlock = (result.data as JsonGuide).blocks[0];
  let duplicateHeadingError: ValidationError | null = null;
  if (firstBlock?.type === 'markdown') {
    const leadingHeading = extractLeadingH1(firstBlock.content);
    if (leadingHeading && headingDuplicatesTitle(leadingHeading, result.data.title)) {
      const message = `blocks[0] starts with a heading ("${leadingHeading}") that duplicates the guide title — the title is already rendered separately; remove this heading.`;
      if (options.allowDuplicateHeading) {
        advisories.push({ message, path: ['blocks', 0], type: 'suggestion' });
      } else {
        duplicateHeadingError = { message, path: ['blocks', 0], code: 'duplicate_heading' };
      }
    }
  }

  const snippetReferenceErrors = validateSnippetReferences(result.data as JsonGuide, options.snippetCatalogIds);
  const errors: ValidationError[] = duplicateHeadingError
    ? [duplicateHeadingError, ...snippetReferenceErrors]
    : [...snippetReferenceErrors];

  // 5. Strict mode - promote all warnings to errors
  if (options.strict && warnings.length > 0) {
    errors.push(...warnings.map((w) => ({ message: w.message, path: w.path, code: 'strict' })));
    return { isValid: false, errors, warnings: advisories, guide: null };
  }

  if (errors.length > 0) {
    return { isValid: false, errors, warnings: [...warnings, ...advisories], guide: null };
  }

  return { isValid: true, errors: [], warnings: [...warnings, ...advisories], guide: result.data as JsonGuide };
}

export function validateGuideFromString(jsonString: string, options: ValidationOptions = {}): ValidationResult {
  let parsed: unknown;
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

export function toLegacyResult(result: ValidationResult): LegacyValidationResult {
  return {
    isValid: result.isValid,
    errors: formatErrorsAsStrings(result.errors),
    warnings: formatWarningsAsStrings(result.warnings),
    guide: result.guide,
  };
}
