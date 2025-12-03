/**
 * Block Import Utilities
 *
 * Functions for importing JSON guides from files with validation.
 */

import type { JsonGuide, JsonBlock } from '../types';
import type {
  JsonInteractiveBlock,
  JsonMultistepBlock,
  JsonGuidedBlock,
  JsonStep,
} from '../../../types/json-guide.types';
/**
 * Maximum file size in bytes (1MB)
 */
export const MAX_FILE_SIZE = 1024 * 1024;

/**
 * All valid block types from JsonBlock union
 * This includes types supported by the block editor plus quiz (which can be previewed but not edited)
 */
const VALID_BLOCK_TYPES = new Set([
  'markdown',
  'html',
  'image',
  'video',
  'section',
  'interactive',
  'multistep',
  'guided',
  'quiz', // Valid JsonBlock type, can be imported and previewed
]);

/**
 * Valid interactive action types
 */
const VALID_ACTIONS = new Set(['highlight', 'button', 'formfill', 'navigate', 'hover']);

/**
 * Validation result with detailed error information
 */
export interface ImportValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  guide: JsonGuide | null;
}

/**
 * Read a file as text
 *
 * @param file - File to read
 * @returns Promise resolving to file contents
 */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to read file as text'));
      }
    };

    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };

    reader.readAsText(file);
  });
}

/**
 * Validate file before reading
 *
 * @param file - File to validate
 * @returns Validation result with errors if invalid
 */
export function validateFile(file: File): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check file size
  if (file.size > MAX_FILE_SIZE) {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
    errors.push(`File exceeds 1MB limit (${sizeMB}MB)`);
  }

  // Check file type
  if (!file.name.endsWith('.json') && file.type !== 'application/json') {
    errors.push('File must be a JSON file (.json)');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Validate a step in a multistep or guided block
 */
function validateStep(step: JsonStep, stepIndex: number, blockIndex: number): string[] {
  const errors: string[] = [];
  const prefix = `Block ${blockIndex + 1}, step ${stepIndex + 1}`;

  if (!step.action) {
    errors.push(`${prefix}: missing required field 'action'`);
  } else if (!VALID_ACTIONS.has(step.action)) {
    errors.push(`${prefix}: unknown action type '${step.action}'`);
  }

  if (!step.reftarget) {
    errors.push(`${prefix}: missing required field 'reftarget'`);
  }

  // formfill action requires targetvalue
  if (step.action === 'formfill' && !step.targetvalue) {
    errors.push(`${prefix}: formfill action requires 'targetvalue'`);
  }

  return errors;
}

/**
 * Validate a single block with type-specific checks
 */
function validateBlock(block: JsonBlock, index: number): string[] {
  const errors: string[] = [];
  const prefix = `Block ${index + 1}`;

  // Check for valid block type
  if (!block.type) {
    errors.push(`${prefix}: missing required field 'type'`);
    return errors;
  }

  if (!VALID_BLOCK_TYPES.has(block.type as string)) {
    errors.push(`${prefix}: unknown block type '${block.type}'`);
    return errors;
  }

  // Type-specific validation
  switch (block.type) {
    case 'markdown':
      if (typeof block.content !== 'string') {
        errors.push(`${prefix} (markdown): missing required field 'content'`);
      }
      break;

    case 'html':
      if (typeof block.content !== 'string') {
        errors.push(`${prefix} (html): missing required field 'content'`);
      }
      break;

    case 'image':
      if (!block.src) {
        errors.push(`${prefix} (image): missing required field 'src'`);
      }
      break;

    case 'video':
      if (!block.src) {
        errors.push(`${prefix} (video): missing required field 'src'`);
      }
      break;

    case 'section':
      if (!Array.isArray(block.blocks)) {
        errors.push(`${prefix} (section): missing required field 'blocks' array`);
      } else {
        // Recursively validate nested blocks
        block.blocks.forEach((nestedBlock, nestedIndex) => {
          errors.push(
            ...validateBlock(nestedBlock, nestedIndex).map((e) =>
              e.replace(`Block ${nestedIndex + 1}`, `${prefix} > Block ${nestedIndex + 1}`)
            )
          );
        });
      }
      break;

    case 'interactive': {
      const interactive = block as JsonInteractiveBlock;
      if (!interactive.action) {
        errors.push(`${prefix} (interactive): missing required field 'action'`);
      } else if (!VALID_ACTIONS.has(interactive.action)) {
        errors.push(`${prefix} (interactive): unknown action type '${interactive.action}'`);
      }
      if (!interactive.reftarget) {
        errors.push(`${prefix} (interactive): missing required field 'reftarget'`);
      }
      if (typeof interactive.content !== 'string') {
        errors.push(`${prefix} (interactive): missing required field 'content'`);
      }
      // formfill action requires targetvalue
      if (interactive.action === 'formfill' && !interactive.targetvalue) {
        errors.push(`${prefix} (interactive): formfill action requires 'targetvalue'`);
      }
      break;
    }

    case 'multistep': {
      const multistep = block as JsonMultistepBlock;
      if (typeof multistep.content !== 'string') {
        errors.push(`${prefix} (multistep): missing required field 'content'`);
      }
      if (!Array.isArray(multistep.steps)) {
        errors.push(`${prefix} (multistep): missing required field 'steps' array`);
      } else {
        (multistep.steps as JsonStep[]).forEach((step: JsonStep, stepIndex: number) => {
          errors.push(...validateStep(step, stepIndex, index));
        });
      }
      break;
    }

    case 'guided': {
      const guided = block as JsonGuidedBlock;
      if (typeof guided.content !== 'string') {
        errors.push(`${prefix} (guided): missing required field 'content'`);
      }
      if (!Array.isArray(guided.steps)) {
        errors.push(`${prefix} (guided): missing required field 'steps' array`);
      } else {
        (guided.steps as JsonStep[]).forEach((step: JsonStep, stepIndex: number) => {
          errors.push(...validateStep(step, stepIndex, index));
        });
      }
      break;
    }
  }

  return errors;
}

/**
 * Parse and validate JSON guide content with detailed error reporting
 *
 * @param jsonString - JSON string to parse
 * @returns Validation result with parsed guide if valid
 */
export function parseAndValidateGuide(jsonString: string): ImportValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Try to parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch (e) {
    return {
      isValid: false,
      errors: ['The file does not contain valid JSON'],
      warnings: [],
      guide: null,
    };
  }

  // Check if it's an object
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      isValid: false,
      errors: ['JSON must be an object with id, title, and blocks'],
      warnings: [],
      guide: null,
    };
  }

  const guide = parsed as Record<string, unknown>;

  // Required top-level fields
  if (!guide.id || typeof guide.id !== 'string') {
    errors.push("Guide is missing required field 'id' (string)");
  }

  if (!guide.title || typeof guide.title !== 'string') {
    errors.push("Guide is missing required field 'title' (string)");
  }

  if (!Array.isArray(guide.blocks)) {
    errors.push("Guide is missing required field 'blocks' (array)");
  }

  // If we have basic structure errors, return early
  if (errors.length > 0) {
    return {
      isValid: false,
      errors,
      warnings,
      guide: null,
    };
  }

  // Validate each block
  const blocks = guide.blocks as JsonBlock[];
  blocks.forEach((block, index) => {
    errors.push(...validateBlock(block, index));
  });

  // Validate match metadata if present
  if (guide.match) {
    const match = guide.match as Record<string, unknown>;
    if (match.urlPrefix && !Array.isArray(match.urlPrefix)) {
      errors.push("'match.urlPrefix' must be an array");
    }
    if (match.tags && !Array.isArray(match.tags)) {
      errors.push("'match.tags' must be an array");
    }
  }

  // Generate warnings for empty guides
  if (blocks.length === 0) {
    warnings.push('Guide has no blocks');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    guide: errors.length === 0 ? (parsed as JsonGuide) : null,
  };
}

/**
 * Complete import workflow: read file, validate, and return result
 *
 * @param file - File to import
 * @returns Promise resolving to validation result
 */
export async function importGuideFromFile(file: File): Promise<ImportValidationResult> {
  // Validate file first
  const fileValidation = validateFile(file);
  if (!fileValidation.isValid) {
    return {
      isValid: false,
      errors: fileValidation.errors,
      warnings: [],
      guide: null,
    };
  }

  // Read file contents
  let content: string;
  try {
    content = await readFileAsText(file);
  } catch (e) {
    return {
      isValid: false,
      errors: ['Unable to read file'],
      warnings: [],
      guide: null,
    };
  }

  // Parse and validate JSON
  return parseAndValidateGuide(content);
}
