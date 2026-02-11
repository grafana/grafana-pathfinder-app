/**
 * Block Editor Utilities
 */

export {
  copyGuideToClipboard,
  downloadGuideAsFile,
  validateGuide,
  formatGuideJson,
  parseGuideJson,
  getGuideSize,
  formatFileSize,
} from './block-export';

export {
  MAX_FILE_SIZE,
  readFileAsText,
  validateFile,
  parseAndValidateGuide,
  importGuideFromFile,
  type ImportValidationResult,
} from './block-import';

export {
  getAvailableConversions,
  getConversionWarning,
  convertBlockType,
  PLACEHOLDER_URL,
  type ConversionWarning,
} from './block-conversion';

export {
  groupRecordedStepsByGroupId,
  convertStepToInteractiveBlock,
  convertStepsToMultistepBlock,
  convertProcessedStepsToBlocks,
  type ProcessedStep,
} from './recorded-steps-processor';

export {
  parseWithPositions,
  addPositionsToErrors,
  type PositionedError,
  type ParseWithPositionsResult,
} from './json-position';

export { getBlockPreview, type BlockPreviewOptions } from './block-preview';
