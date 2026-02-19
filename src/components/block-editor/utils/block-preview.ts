/**
 * Block Preview Utility
 *
 * Generates human-readable preview strings for block types.
 * Used in block lists and editors to show a summary of block content.
 */

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
  isQuizBlock,
  isInputBlock,
  isTerminalBlock,
  type JsonBlock,
} from '../../../types/json-guide.types';

/**
 * Truncate a string to a maximum length, adding ellipsis if truncated.
 */
function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

/**
 * Options for generating block previews.
 */
export interface BlockPreviewOptions {
  /** Maximum length for text content (default: 60) */
  maxLength?: number;
  /** Text to show when interactive block has no target (default: '(no target)') */
  noTargetText?: string;
}

const DEFAULT_OPTIONS: Required<BlockPreviewOptions> = {
  maxLength: 60,
  noTargetText: '(no target)',
};

/**
 * Generate a preview string for a block.
 *
 * @param block - The block to generate a preview for
 * @param options - Optional configuration for preview generation
 * @returns A human-readable preview string
 */
export function getBlockPreview(block: JsonBlock, options: BlockPreviewOptions = {}): string {
  const { maxLength, noTargetText } = { ...DEFAULT_OPTIONS, ...options };

  if (isMarkdownBlock(block)) {
    const firstLine = block.content.split('\n')[0];
    return truncate(firstLine, maxLength);
  }

  if (isHtmlBlock(block)) {
    // Strip HTML tags and show text
    const text = block.content.replace(/<[^>]+>/g, ' ').trim();
    return truncate(text, maxLength);
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

  if (isInteractiveBlock(block)) {
    return `${block.action}: ${block.reftarget || noTargetText}`;
  }

  if (isMultistepBlock(block)) {
    const count = block.steps.length;
    return `${count} step${count !== 1 ? 's' : ''}`;
  }

  if (isGuidedBlock(block)) {
    const count = block.steps.length;
    return `${count} guided step${count !== 1 ? 's' : ''}`;
  }

  if (isConditionalBlock(block)) {
    if (block.description) {
      return block.description;
    }
    return `If: ${block.conditions.join(', ')}`;
  }

  if (isQuizBlock(block)) {
    return truncate(block.question, maxLength);
  }

  if (isInputBlock(block)) {
    // Replace newlines with spaces for cleaner display
    const prompt = block.prompt.replace(/\n/g, ' ').trim();
    return truncate(prompt, maxLength);
  }

  if (isTerminalBlock(block)) {
    return truncate(`$ ${block.command}`, maxLength);
  }

  // Fallback for unknown block types with content
  if ('content' in block && typeof block.content === 'string') {
    return truncate(block.content, maxLength);
  }

  return '';
}
