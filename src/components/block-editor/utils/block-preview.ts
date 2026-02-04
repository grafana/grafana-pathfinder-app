/**
 * Block Preview Utility
 *
 * Generates preview strings for different block types.
 */

import type { JsonBlock } from '../types';
import {
  isMarkdownBlock,
  isHtmlBlock,
  isImageBlock,
  isVideoBlock,
  isSectionBlock,
  isInteractiveBlock,
  isMultistepBlock,
  isGuidedBlock,
  isConditionalBlock,
  isInputBlock,
  isQuizBlock,
} from '../../../types/json-guide.types';

const DEFAULT_MAX_LENGTH = 60;

/**
 * Get a preview string for any block type
 */
export function getBlockPreview(block: JsonBlock, maxLength: number = DEFAULT_MAX_LENGTH): string {
  if (isMarkdownBlock(block)) {
    const firstLine = block.content.split('\n')[0];
    return firstLine.slice(0, maxLength) + (firstLine.length > maxLength ? '...' : '');
  }
  if (isHtmlBlock(block)) {
    // Strip HTML tags and show text
    const text = block.content.replace(/<[^>]+>/g, ' ').trim();
    return text.slice(0, maxLength) + (text.length > maxLength ? '...' : '');
  }
  if (isInteractiveBlock(block)) {
    return `${block.action}: ${block.reftarget || '(no target)'}`;
  }
  if (isMultistepBlock(block)) {
    return `${block.steps.length} step${block.steps.length !== 1 ? 's' : ''}`;
  }
  if (isGuidedBlock(block)) {
    return `${block.steps.length} guided step${block.steps.length !== 1 ? 's' : ''}`;
  }
  if (isImageBlock(block)) {
    return block.alt || block.src;
  }
  if (isVideoBlock(block)) {
    return block.title || block.src;
  }
  if (isSectionBlock(block)) {
    return block.title || block.id || `${block.blocks.length} blocks`;
  }
  if (isQuizBlock(block)) {
    return block.question.slice(0, maxLength) + (block.question.length > maxLength ? '...' : '');
  }
  if (isConditionalBlock(block)) {
    // Show description if available, otherwise show conditions
    if (block.description) {
      return block.description;
    }
    return `If: ${block.conditions.join(', ')}`;
  }
  if (isInputBlock(block)) {
    const prompt = block.prompt.replace(/\n/g, ' ').trim();
    return prompt.slice(0, maxLength) + (prompt.length > maxLength ? '...' : '');
  }
  if ('content' in block && typeof block.content === 'string') {
    return block.content.slice(0, maxLength) + (block.content.length > maxLength ? '...' : '');
  }
  return '';
}
