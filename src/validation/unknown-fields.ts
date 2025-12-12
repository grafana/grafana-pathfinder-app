/**
 * Unknown field detection for forward compatibility
 */
import { KNOWN_FIELDS } from '../types/json-guide.schema';
import { formatPath, type ValidationWarning } from './errors';

function checkUnknownFields(
  obj: Record<string, unknown>,
  knownFields: ReadonlySet<string>,
  path: Array<string | number>
): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];
  for (const key of Object.keys(obj)) {
    if (!knownFields.has(key)) {
      warnings.push({
        message: `Unknown field '${key}' at ${formatPath(path)}`,
        path: [...path, key],
        type: 'unknown-field',
      });
    }
  }
  return warnings;
}

function detectUnknownFieldsInBlock(block: Record<string, unknown>, path: Array<string | number>): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];
  const blockType = block.type as string;
  const knownFields = KNOWN_FIELDS[blockType];
  if (!knownFields) {
    return warnings;
  }
  warnings.push(...checkUnknownFields(block, knownFields, path));
  if (Array.isArray(block.blocks)) {
    (block.blocks as Array<Record<string, unknown>>).forEach((nestedBlock, index) => {
      warnings.push(...detectUnknownFieldsInBlock(nestedBlock, [...path, 'blocks', index]));
    });
  }
  if (Array.isArray(block.steps)) {
    const stepFields = KNOWN_FIELDS._step;
    if (stepFields) {
      (block.steps as Array<Record<string, unknown>>).forEach((step, index) => {
        warnings.push(...checkUnknownFields(step, stepFields, [...path, 'steps', index]));
      });
    }
  }
  if (Array.isArray(block.choices)) {
    const choiceFields = KNOWN_FIELDS._choice;
    if (choiceFields) {
      (block.choices as Array<Record<string, unknown>>).forEach((choice, index) => {
        warnings.push(...checkUnknownFields(choice, choiceFields, [...path, 'choices', index]));
      });
    }
  }
  return warnings;
}

export function detectUnknownFields(guide: unknown): ValidationWarning[] {
  if (!guide || typeof guide !== 'object') {
    return [];
  }
  const warnings: ValidationWarning[] = [];
  const guideObj = guide as Record<string, unknown>;
  const guideFields = KNOWN_FIELDS._guide;
  if (guideFields) {
    warnings.push(...checkUnknownFields(guideObj, guideFields, []));
  }
  if (guideObj.match && typeof guideObj.match === 'object') {
    const matchFields = KNOWN_FIELDS._match;
    if (matchFields) {
      warnings.push(...checkUnknownFields(guideObj.match as Record<string, unknown>, matchFields, ['match']));
    }
  }
  if (Array.isArray(guideObj.blocks)) {
    (guideObj.blocks as Array<Record<string, unknown>>).forEach((block, index) => {
      warnings.push(...detectUnknownFieldsInBlock(block, ['blocks', index]));
    });
  }
  return warnings;
}
