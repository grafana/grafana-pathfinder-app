/**
 * Editor to JSON Converter Service
 *
 * Converts Tiptap editor content to JsonGuide format for export.
 * This is the inverse of json-parser.ts which converts JSON to ParsedElements.
 */

import type { Editor } from '@tiptap/react';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type {
  JsonGuide,
  JsonBlock,
  JsonMarkdownBlock,
  JsonSectionBlock,
  JsonInteractiveBlock,
  JsonMultistepBlock,
  JsonGuidedBlock,
  JsonStep,
  JsonInteractiveAction,
} from '../../../types/json-guide.types';
import { debug } from '../utils/logger';

/**
 * Guide metadata for export
 */
export interface GuideMetadata {
  id: string;
  title: string;
}

/**
 * Result of converting editor content to JSON
 */
export interface ConversionResult {
  guide: JsonGuide;
  warnings: string[];
}

/**
 * Convert Tiptap editor content to JsonGuide format.
 *
 * @param editor - Tiptap editor instance
 * @param metadata - Guide id and title
 * @returns ConversionResult with the guide and any warnings
 */
export function convertEditorToJson(editor: Editor, metadata: GuideMetadata): ConversionResult {
  const warnings: string[] = [];
  const doc = editor.state.doc;

  debug('[editorToJson] Starting conversion', { metadata });

  const blocks: JsonBlock[] = [];

  // Walk through top-level nodes
  doc.forEach((node, _offset, _index) => {
    const convertedBlocks = convertNodeToBlocks(node, warnings);
    blocks.push(...convertedBlocks);
  });

  // Merge consecutive markdown blocks for cleaner output
  const mergedBlocks = mergeConsecutiveMarkdownBlocks(blocks);

  const guide: JsonGuide = {
    id: metadata.id,
    title: metadata.title,
    blocks: mergedBlocks,
  };

  debug('[editorToJson] Conversion complete', { blockCount: mergedBlocks.length, warningCount: warnings.length });

  return { guide, warnings };
}

/**
 * Convert a ProseMirror node to JsonBlock(s).
 * Some nodes may produce multiple blocks (e.g., lists produce items).
 */
function convertNodeToBlocks(node: ProseMirrorNode, warnings: string[]): JsonBlock[] {
  const nodeType = node.type.name;

  switch (nodeType) {
    case 'sequenceSection':
      return [convertSequenceSection(node, warnings)];

    case 'heading':
      return [convertHeading(node)];

    case 'paragraph':
      return convertParagraph(node, warnings);

    case 'bulletList':
    case 'orderedList':
      return convertList(node, warnings);

    case 'codeBlock':
      return [convertCodeBlock(node)];

    case 'blockquote':
      return [convertBlockquote(node)];

    case 'horizontalRule':
      return [{ type: 'markdown', content: '---' }];

    default:
      // For unknown block types, try to extract text content
      const textContent = getTextContent(node);
      if (textContent.trim()) {
        warnings.push(`Unknown node type "${nodeType}" converted to markdown`);
        return [{ type: 'markdown', content: textContent }];
      }
      return [];
  }
}

/**
 * Convert a sequenceSection node to JsonSectionBlock
 */
function convertSequenceSection(node: ProseMirrorNode, warnings: string[]): JsonSectionBlock {
  const attrs = node.attrs;
  const sectionId = attrs.id || undefined;
  const requirements = parseRequirements(attrs['data-requirements']);

  // Extract title from first heading if present
  let title: string | undefined;
  const blocks: JsonBlock[] = [];

  node.forEach((childNode) => {
    if (childNode.type.name === 'heading' && !title) {
      title = getTextContent(childNode);
    } else {
      const childBlocks = convertNodeToBlocks(childNode, warnings);
      blocks.push(...childBlocks);
    }
  });

  const section: JsonSectionBlock = {
    type: 'section',
    blocks,
  };

  if (sectionId) {
    section.id = sectionId;
  }
  if (title) {
    section.title = title;
  }
  if (requirements && requirements.length > 0) {
    section.requirements = requirements;
  }

  return section;
}

/**
 * Convert a heading node to JsonMarkdownBlock
 */
function convertHeading(node: ProseMirrorNode): JsonMarkdownBlock {
  const level = node.attrs.level || 1;
  const prefix = '#'.repeat(level);
  const content = serializeInlineContent(node);

  return {
    type: 'markdown',
    content: `${prefix} ${content}`,
  };
}

/**
 * Convert a paragraph node to JsonBlock(s).
 * May produce interactive blocks if paragraph contains interactive spans.
 */
function convertParagraph(node: ProseMirrorNode, warnings: string[]): JsonBlock[] {
  // Check if paragraph contains interactive elements
  const interactiveBlocks = extractInteractiveFromParagraph(node, warnings);
  if (interactiveBlocks.length > 0) {
    return interactiveBlocks;
  }

  // Regular paragraph - convert to markdown
  const content = serializeInlineContent(node);
  if (!content.trim()) {
    return [];
  }

  return [{ type: 'markdown', content }];
}

/**
 * Extract interactive blocks from a paragraph containing interactive spans
 */
function extractInteractiveFromParagraph(node: ProseMirrorNode, warnings: string[]): JsonBlock[] {
  const blocks: JsonBlock[] = [];
  let hasInteractive = false;

  node.forEach((child) => {
    if (child.type.name === 'interactiveSpan') {
      hasInteractive = true;
      const block = convertInteractiveSpan(child, warnings);
      if (block) {
        blocks.push(block);
      }
    }
  });

  if (!hasInteractive) {
    return [];
  }

  // If there's mixed content (text + interactive), we need to handle it
  // For now, return interactive blocks and warn about lost content
  if (blocks.length > 0 && node.childCount > blocks.length) {
    warnings.push('Paragraph with mixed content converted; some text content may be lost');
  }

  return blocks;
}

/**
 * Convert an interactiveSpan node to JsonInteractiveBlock
 * Handles both atomic nodes (text in attribute) and legacy non-atomic nodes (text in content)
 */
function convertInteractiveSpan(node: ProseMirrorNode, warnings: string[]): JsonInteractiveBlock | null {
  const attrs = node.attrs;
  const actionAttr = attrs['data-targetaction'] as string | undefined;
  const reftarget = attrs['data-reftarget'];

  if (!actionAttr || !reftarget) {
    warnings.push('Interactive span missing required action or reftarget');
    return null;
  }

  // Handle multistep action type (not a JsonInteractiveAction, but a separate block type)
  if (actionAttr === 'multistep') {
    // Multistep spans have child interactive spans as steps
    const multistepBlock = convertMultistepSpan(node, warnings);
    if (multistepBlock) {
      return multistepBlock as unknown as JsonInteractiveBlock;
    }
  }

  // Handle guided action type (user-performed sequences)
  if (actionAttr === 'guided') {
    // Guided spans have child interactive spans as steps
    const guidedBlock = convertGuidedSpan(node, warnings);
    if (guidedBlock) {
      return guidedBlock as unknown as JsonInteractiveBlock;
    }
  }

  // Cast to JsonInteractiveAction after checking for multistep/guided
  const action = actionAttr as JsonInteractiveAction;

  // For atomic nodes, read text from the 'text' attribute
  // Fall back to serializing content for non-atomic nodes
  const content = attrs.text || serializeInlineContent(node);
  const requirements = parseRequirements(attrs['data-requirements']);

  // Extract tooltip from interactiveComment children or from nested comment's text attribute
  const tooltip = extractTooltipFromNode(node);

  const block: JsonInteractiveBlock = {
    type: 'interactive',
    action,
    reftarget,
    content: content || 'Interactive step',
  };

  if (attrs['data-targetvalue']) {
    block.targetvalue = attrs['data-targetvalue'];
  }
  if (requirements && requirements.length > 0) {
    block.requirements = requirements;
  }
  if (tooltip) {
    block.tooltip = tooltip;
  }
  if (attrs['data-doit'] === 'false') {
    block.doIt = false;
  }

  return block;
}

/**
 * Convert a multistep span to JsonMultistepBlock
 */
function convertMultistepSpan(node: ProseMirrorNode, warnings: string[]): JsonMultistepBlock | null {
  const attrs = node.attrs;
  const requirements = parseRequirements(attrs['data-requirements']);

  const steps: JsonStep[] = [];
  let textContent = '';

  node.forEach((child) => {
    if (child.type.name === 'interactiveSpan') {
      const childAttrs = child.attrs;
      const actionAttr = childAttrs['data-targetaction'] as string | undefined;
      const reftarget = childAttrs['data-reftarget'];

      // Skip multistep actions - they are container types, not step actions
      if (actionAttr && reftarget && actionAttr !== 'multistep') {
        const action = actionAttr as JsonInteractiveAction;
        const step: JsonStep = {
          action,
          reftarget,
        };

        if (childAttrs['data-targetvalue']) {
          step.targetvalue = childAttrs['data-targetvalue'];
        }

        const stepRequirements = parseRequirements(childAttrs['data-requirements']);
        if (stepRequirements && stepRequirements.length > 0) {
          step.requirements = stepRequirements;
        }

        const tooltip = extractTooltipFromNode(child);
        if (tooltip) {
          step.tooltip = tooltip;
        }

        steps.push(step);
      }
    } else if (child.isText) {
      textContent += child.text || '';
    }
  });

  if (steps.length === 0) {
    warnings.push('Multistep block has no steps');
    return null;
  }

  // Step-level tooltips are already extracted on individual steps
  // Don't prepend tooltips to content - they belong on the steps
  const block: JsonMultistepBlock = {
    type: 'multistep',
    content: textContent.trim() || 'Multi-step action',
    steps,
  };

  if (requirements && requirements.length > 0) {
    block.requirements = requirements;
  }

  return block;
}

/**
 * Convert a guided span to JsonGuidedBlock
 */
function convertGuidedSpan(node: ProseMirrorNode, warnings: string[]): JsonGuidedBlock | null {
  const attrs = node.attrs;
  const requirements = parseRequirements(attrs['data-requirements']);

  const steps: JsonStep[] = [];
  let textContent = '';

  node.forEach((child) => {
    if (child.type.name === 'interactiveSpan') {
      const childAttrs = child.attrs;
      const actionAttr = childAttrs['data-targetaction'] as string | undefined;
      const reftarget = childAttrs['data-reftarget'];

      // Skip guided/multistep actions - they are container types, not step actions
      if (actionAttr && reftarget && actionAttr !== 'multistep' && actionAttr !== 'guided') {
        const action = actionAttr as JsonInteractiveAction;
        const step: JsonStep = {
          action,
          reftarget,
        };

        if (childAttrs['data-targetvalue']) {
          step.targetvalue = childAttrs['data-targetvalue'];
        }

        const stepRequirements = parseRequirements(childAttrs['data-requirements']);
        if (stepRequirements && stepRequirements.length > 0) {
          step.requirements = stepRequirements;
        }

        const tooltip = extractTooltipFromNode(child);
        if (tooltip) {
          step.tooltip = tooltip;
        }

        // Check for skippable attribute on individual steps
        if (childAttrs['data-skippable'] === 'true') {
          step.skippable = true;
        }

        steps.push(step);
      }
    } else if (child.isText) {
      textContent += child.text || '';
    }
  });

  if (steps.length === 0) {
    warnings.push('Guided block has no steps');
    return null;
  }

  // Step-level tooltips are already extracted on individual steps
  // Don't prepend tooltips to content - they belong on the steps
  const block: JsonGuidedBlock = {
    type: 'guided',
    content: textContent.trim() || 'Guided action',
    steps,
  };

  if (requirements && requirements.length > 0) {
    block.requirements = requirements;
  }

  // Check for guided-specific attributes
  if (attrs['data-step-timeout']) {
    const timeout = parseInt(attrs['data-step-timeout'], 10);
    if (!isNaN(timeout)) {
      block.stepTimeout = timeout;
    }
  }

  if (attrs['data-skippable'] === 'true') {
    block.skippable = true;
  }

  if (attrs['data-complete-early'] === 'true') {
    block.completeEarly = true;
  }

  return block;
}

/**
 * Convert a list to JsonBlock(s).
 * Handles both regular lists (converted to markdown) and lists with interactive items.
 */
function convertList(node: ProseMirrorNode, warnings: string[]): JsonBlock[] {
  const isOrdered = node.type.name === 'orderedList';
  const blocks: JsonBlock[] = [];
  const markdownItems: string[] = [];
  let itemIndex = 1;

  node.forEach((listItem) => {
    const isInteractive = listItem.attrs.class?.includes('interactive');

    if (isInteractive) {
      // Flush any pending markdown items first
      if (markdownItems.length > 0) {
        blocks.push({ type: 'markdown', content: markdownItems.join('\n') });
        markdownItems.length = 0;
      }

      // Convert interactive list item
      const interactiveBlock = convertInteractiveListItem(listItem, warnings);
      if (interactiveBlock) {
        blocks.push(interactiveBlock);
      }
    } else {
      // Regular list item - accumulate for markdown
      const content = serializeListItemContent(listItem);
      const prefix = isOrdered ? `${itemIndex}.` : '-';
      markdownItems.push(`${prefix} ${content}`);
    }

    itemIndex++;
  });

  // Flush remaining markdown items
  if (markdownItems.length > 0) {
    blocks.push({ type: 'markdown', content: markdownItems.join('\n') });
  }

  return blocks;
}

/**
 * Convert an interactive list item to JsonInteractiveBlock, JsonMultistepBlock, or JsonGuidedBlock
 */
function convertInteractiveListItem(node: ProseMirrorNode, warnings: string[]): JsonBlock | null {
  const attrs = node.attrs;
  const actionAttr = attrs['data-targetaction'] as string | undefined;
  const reftarget = attrs['data-reftarget'];

  // Check for guided action type first
  if (actionAttr === 'guided') {
    const nestedSteps = extractNestedInteractiveSteps(node);
    // getTextContent already excludes interactiveComment nodes
    // Step-level tooltips are already extracted in extractNestedInteractiveSteps
    const content = getTextContent(node);
    const requirements = parseRequirements(attrs['data-requirements']);

    const block: JsonGuidedBlock = {
      type: 'guided',
      content: content || 'Guided action',
      steps: nestedSteps,
    };

    if (requirements && requirements.length > 0) {
      block.requirements = requirements;
    }

    // Check for guided-specific attributes
    if (attrs['data-step-timeout']) {
      const timeout = parseInt(attrs['data-step-timeout'], 10);
      if (!isNaN(timeout)) {
        block.stepTimeout = timeout;
      }
    }

    if (attrs['data-skippable'] === 'true') {
      block.skippable = true;
    }

    if (attrs['data-complete-early'] === 'true') {
      block.completeEarly = true;
    }

    return block;
  }

  // Check for nested interactive spans (multistep pattern) or explicit multistep action
  const nestedSteps = extractNestedInteractiveSteps(node);
  if (nestedSteps.length > 0 || actionAttr === 'multistep') {
    // getTextContent already excludes interactiveComment nodes
    // Step-level tooltips are already extracted in extractNestedInteractiveSteps
    const content = getTextContent(node);
    const requirements = parseRequirements(attrs['data-requirements']);

    const block: JsonMultistepBlock = {
      type: 'multistep',
      content: content || 'Multi-step action',
      steps: nestedSteps,
    };

    if (requirements && requirements.length > 0) {
      block.requirements = requirements;
    }

    return block;
  }

  // Cast to JsonInteractiveAction for single action items
  const action = actionAttr as JsonInteractiveAction;

  // Single action interactive item
  if (!action || !reftarget) {
    warnings.push('Interactive list item missing required action or reftarget');
    return null;
  }

  const content = getTextContent(node);
  const requirements = parseRequirements(attrs['data-requirements']);
  const tooltip = extractTooltipFromNode(node);

  const block: JsonInteractiveBlock = {
    type: 'interactive',
    action,
    reftarget,
    content: content || 'Interactive step',
  };

  if (attrs['data-targetvalue']) {
    block.targetvalue = attrs['data-targetvalue'];
  }
  if (requirements && requirements.length > 0) {
    block.requirements = requirements;
  }
  if (tooltip) {
    block.tooltip = tooltip;
  }
  if (attrs['data-doit'] === 'false') {
    block.doIt = false;
  }

  return block;
}

/**
 * Extract nested interactive spans as steps (for multistep/guided detection)
 */
function extractNestedInteractiveSteps(node: ProseMirrorNode): JsonStep[] {
  const steps: JsonStep[] = [];

  node.descendants((child) => {
    if (child.type.name === 'interactiveSpan') {
      const attrs = child.attrs;
      const actionAttr = attrs['data-targetaction'] as string | undefined;
      const reftarget = attrs['data-reftarget'];

      // Skip multistep/guided actions - they are container types, not step actions
      if (actionAttr && reftarget && actionAttr !== 'multistep' && actionAttr !== 'guided') {
        const action = actionAttr as JsonInteractiveAction;
        const step: JsonStep = {
          action,
          reftarget,
        };

        if (attrs['data-targetvalue']) {
          step.targetvalue = attrs['data-targetvalue'];
        }

        const stepRequirements = parseRequirements(attrs['data-requirements']);
        if (stepRequirements && stepRequirements.length > 0) {
          step.requirements = stepRequirements;
        }

        // Extract tooltip from any interactiveComment children within this step
        const stepTooltip = extractTooltipFromNode(child);
        if (stepTooltip) {
          step.tooltip = stepTooltip;
        }

        steps.push(step);
      }
    }
    return true; // Continue traversal
  });

  return steps;
}

/**
 * Convert a code block to markdown
 */
function convertCodeBlock(node: ProseMirrorNode): JsonMarkdownBlock {
  const language = node.attrs.language || '';
  const code = getTextContent(node);

  return {
    type: 'markdown',
    content: `\`\`\`${language}\n${code}\n\`\`\``,
  };
}

/**
 * Convert a blockquote to markdown
 */
function convertBlockquote(node: ProseMirrorNode): JsonMarkdownBlock {
  const lines: string[] = [];

  node.forEach((child) => {
    const content = serializeInlineContent(child);
    lines.push(`> ${content}`);
  });

  return {
    type: 'markdown',
    content: lines.join('\n'),
  };
}

/**
 * Serialize inline content of a node to markdown string.
 * Handles text marks (bold, italic, code, links).
 */
function serializeInlineContent(node: ProseMirrorNode): string {
  let result = '';

  node.forEach((child) => {
    if (child.isText) {
      let text = child.text || '';

      // Apply marks in reverse order for proper nesting
      const marks = child.marks;
      for (const mark of marks) {
        switch (mark.type.name) {
          case 'bold':
            text = `**${text}**`;
            break;
          case 'italic':
            text = `*${text}*`;
            break;
          case 'code':
            text = `\`${text}\``;
            break;
          case 'link':
            text = `[${text}](${mark.attrs.href})`;
            break;
        }
      }

      result += text;
    } else if (child.type.name === 'interactiveComment') {
      // Skip interactive comments in regular content serialization
      // They become tooltips in interactive blocks
    } else if (child.type.name === 'interactiveSpan') {
      // Serialize the content of interactive spans as regular text
      result += serializeInlineContent(child);
    } else if (child.type.name === 'hardBreak') {
      result += '\n';
    } else {
      // Recursively handle other inline nodes
      result += serializeInlineContent(child);
    }
  });

  return result;
}

/**
 * Serialize list item content, handling nested paragraphs
 */
function serializeListItemContent(node: ProseMirrorNode): string {
  const parts: string[] = [];

  node.forEach((child) => {
    if (child.type.name === 'paragraph') {
      parts.push(serializeInlineContent(child));
    } else {
      parts.push(getTextContent(child));
    }
  });

  return parts.join(' ').trim();
}

/**
 * Get plain text content from a node, excluding interactive comments and interactive spans.
 * Interactive comments should become tooltips, not part of the content.
 * Interactive spans contain step data (selectors), not description text.
 */
function getTextContent(node: ProseMirrorNode): string {
  let text = '';

  node.descendants((child, _pos, parent) => {
    // Skip text inside interactiveComment nodes
    if (parent && parent.type.name === 'interactiveComment') {
      return false; // Don't descend into comment content
    }
    // Skip text inside interactiveSpan nodes (they contain step selectors, not descriptions)
    if (parent && parent.type.name === 'interactiveSpan') {
      return false; // Don't descend into interactive span content
    }
    if (child.type.name === 'interactiveComment') {
      return false; // Skip the comment node entirely
    }
    if (child.type.name === 'interactiveSpan') {
      return false; // Skip the interactive span node entirely
    }
    if (child.isText) {
      text += child.text;
    } else if (child.type.name === 'hardBreak') {
      text += '\n';
    }
    return true;
  });

  return text;
}

/**
 * Extract tooltip text from a node.
 * Priority:
 * 1. For atomic interactiveSpan nodes, check the 'tooltip' attribute first
 * 2. Fall back to extracting from nested interactiveComment children
 * Handles both atomic comments (text in attribute) and legacy comments (text in content).
 * If multiple comments exist, they are concatenated with newlines.
 */
function extractTooltipFromNode(node: ProseMirrorNode): string | undefined {
  // First check if this node has a tooltip attribute (atomic interactiveSpan)
  if (node.attrs.tooltip && node.attrs.tooltip.trim()) {
    return node.attrs.tooltip.trim();
  }

  // Fall back to looking for nested interactiveComment children
  const tooltips: string[] = [];

  node.descendants((child) => {
    if (child.type.name === 'interactiveComment') {
      // For atomic nodes, check the text attribute first
      if (child.attrs.text) {
        if (child.attrs.text.trim()) {
          tooltips.push(child.attrs.text.trim());
        }
        return false; // Don't descend further
      }

      // Fall back to extracting from content for non-atomic nodes
      let commentText = '';
      child.descendants((textNode) => {
        if (textNode.isText) {
          commentText += textNode.text;
        }
        return true;
      });
      if (commentText.trim()) {
        tooltips.push(commentText.trim());
      }
      return false; // Don't descend further into this comment
    }
    return true;
  });

  return tooltips.length > 0 ? tooltips.join('\n\n') : undefined;
}

/**
 * Parse requirements string to array
 */
function parseRequirements(requirementsStr: string | null | undefined): string[] | undefined {
  if (!requirementsStr) {
    return undefined;
  }

  const requirements = requirementsStr
    .split(',')
    .map((r) => r.trim())
    .filter((r) => r.length > 0);

  return requirements.length > 0 ? requirements : undefined;
}

/**
 * Merge consecutive markdown blocks into single blocks for cleaner output
 */
function mergeConsecutiveMarkdownBlocks(blocks: JsonBlock[]): JsonBlock[] {
  const result: JsonBlock[] = [];
  let pendingMarkdown: string[] = [];

  const flushMarkdown = () => {
    if (pendingMarkdown.length > 0) {
      result.push({
        type: 'markdown',
        content: pendingMarkdown.join('\n\n'),
      });
      pendingMarkdown = [];
    }
  };

  for (const block of blocks) {
    if (block.type === 'markdown') {
      pendingMarkdown.push(block.content);
    } else {
      flushMarkdown();
      result.push(block);
    }
  }

  flushMarkdown();

  return result;
}

/**
 * Generate a slug ID from a title
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

/**
 * Format JsonGuide as a pretty-printed JSON string
 */
export function formatJsonGuide(guide: JsonGuide): string {
  return JSON.stringify(guide, null, 2);
}
