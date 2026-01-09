/**
 * Guide Website Shortcode Export Utilities
 *
 * Converts JsonGuide blocks from the block editor into shortcode format
 * for use in Grafana documentation website.
 */

import type {
  JsonGuide,
  JsonBlock,
  JsonMarkdownBlock,
  JsonSectionBlock,
  JsonInteractiveBlock,
  JsonMultistepBlock,
  JsonGuidedBlock,
  JsonStep,
  JsonConditionalBlock,
  JsonQuizBlock,
  JsonInputBlock,
  JsonImageBlock,
  JsonVideoBlock,
} from '../types/json-guide.types';

export interface GuideWebsiteExportOptions {
  /** Include HTML comments with metadata */
  includeComments?: boolean;
}

/**
 * Convert a JsonGuide to website shortcode format
 */
export function exportGuideForWebsite(guide: JsonGuide, options: GuideWebsiteExportOptions = {}): string {
  const { includeComments = true } = options;

  let output = '';

  if (includeComments) {
    output += `<!-- Guide: ${guide.title} (ID: ${guide.id}) -->\n\n`;
  }

  for (const block of guide.blocks) {
    output += formatBlockForWebsite(block, includeComments, 0);
  }

  return output;
}

/**
 * Format a single block as website shortcode
 */
function formatBlockForWebsite(block: JsonBlock, includeComments: boolean, indentLevel: number): string {
  const indent = '  '.repeat(indentLevel);

  switch (block.type) {
    case 'markdown':
      return formatMarkdownBlock(block, indent);

    case 'html':
      return `${indent}${block.content}\n\n`;

    case 'section':
      return formatSectionBlock(block, includeComments, indentLevel);

    case 'interactive':
      return formatInteractiveBlock(block, indent);

    case 'multistep':
      return formatMultistepBlock(block, indent);

    case 'guided':
      return formatGuidedBlock(block, indent);

    case 'conditional':
      return formatConditionalBlock(block, includeComments, indentLevel);

    case 'quiz':
      return formatQuizBlock(block, indent);

    case 'input':
      return formatInputBlock(block, indent);

    case 'image':
      return formatImageBlock(block, indent);

    case 'video':
      return formatVideoBlock(block, indent);

    case 'assistant':
      // Assistant blocks wrap child blocks
      let assistantOutput = '';
      for (const childBlock of block.blocks) {
        assistantOutput += formatBlockForWebsite(childBlock, includeComments, indentLevel);
      }
      return assistantOutput;

    default:
      return '';
  }
}

function formatMarkdownBlock(block: JsonMarkdownBlock, indent: string): string {
  return `${indent}${block.content}\n\n`;
}

function formatSectionBlock(block: JsonSectionBlock, includeComments: boolean, indentLevel: number): string {
  const indent = '  '.repeat(indentLevel);
  let output = '';

  const sectionId = block.id || generateSectionId(block.title);
  output += `${indent}{{< interactive/sequence id="${sectionId}"`;
  if (block.title) {
    output += ` title="${escapeShortcodeString(block.title)}"`;
  }
  output += ` >}}\n\n`;

  for (const childBlock of block.blocks) {
    output += formatBlockForWebsite(childBlock, includeComments, indentLevel + 1);
  }

  output += `${indent}{{< /interactive/sequence >}}\n\n`;
  return output;
}

function formatInteractiveBlock(block: JsonInteractiveBlock, indent: string): string {
  const shortcodeName = `interactive/${block.action}`;
  let output = '';

  output += `${indent}{{< ${shortcodeName}`;
  
  // noop actions don't require reftarget
  if (block.action !== 'noop' || block.reftarget) {
    output += ` reftarget="${escapeShortcodeString(block.reftarget)}"`;
  }

  if (block.action === 'formfill' && block.targetvalue) {
    output += ` targetvalue="${escapeShortcodeString(block.targetvalue)}"`;
  }
  if (block.tooltip) {
    output += ` tooltip="${escapeShortcodeString(block.tooltip)}"`;
  }
  if (block.hint) {
    output += ` hint="${escapeShortcodeString(block.hint)}"`;
  }
  if (block.requirements && block.requirements.length > 0) {
    output += ` requirements="${block.requirements.join(',')}"`;
  }
  if (block.objectives && block.objectives.length > 0) {
    output += ` objectives="${block.objectives.join(',')}"`;
  }
  if (block.skippable) {
    output += ` skippable="true"`;
  }

  output += ` >}}\n`;
  output += `${indent}${block.content}\n`;
  output += `${indent}{{< /${shortcodeName} >}}\n\n`;

  return output;
}

function formatMultistepBlock(block: JsonMultistepBlock, indent: string): string {
  let output = '';

  output += `${indent}{{< interactive/multistep`;
  if (block.requirements && block.requirements.length > 0) {
    output += ` requirements="${block.requirements.join(',')}"`;
  }
  if (block.objectives && block.objectives.length > 0) {
    output += ` objectives="${block.objectives.join(',')}"`;
  }
  if (block.skippable) {
    output += ` skippable="true"`;
  }
  output += ` >}}\n`;
  output += `${indent}${block.content}\n`;

  for (const step of block.steps) {
    output += formatStepForWebsite(step, indent);
  }

  output += `${indent}{{< /interactive/multistep >}}\n\n`;
  return output;
}

function formatGuidedBlock(block: JsonGuidedBlock, indent: string): string {
  let output = '';

  output += `${indent}{{< interactive/guided`;
  if (block.stepTimeout) {
    output += ` stepTimeout="${block.stepTimeout}"`;
  }
  if (block.requirements && block.requirements.length > 0) {
    output += ` requirements="${block.requirements.join(',')}"`;
  }
  if (block.objectives && block.objectives.length > 0) {
    output += ` objectives="${block.objectives.join(',')}"`;
  }
  if (block.skippable) {
    output += ` skippable="true"`;
  }
  output += ` >}}\n`;
  output += `${indent}${block.content}\n`;

  for (const step of block.steps) {
    output += formatStepForWebsite(step, indent, true);
  }

  output += `${indent}{{< /interactive/guided >}}\n\n`;
  return output;
}

function formatStepForWebsite(step: JsonStep, indent: string, isGuided = false): string {
  const shortcodeName = `interactive/${step.action}`;
  let output = '';

  output += `${indent}{{< ${shortcodeName}`;
  
  // noop actions don't require reftarget
  if (step.action !== 'noop' || step.reftarget) {
    output += ` reftarget="${escapeShortcodeString(step.reftarget)}"`;
  }

  if (step.action === 'formfill' && step.targetvalue) {
    output += ` targetvalue="${escapeShortcodeString(step.targetvalue)}"`;
  }
  if (isGuided && step.description) {
    output += ` description="${escapeShortcodeString(step.description)}"`;
  }
  if (!isGuided && step.tooltip) {
    output += ` tooltip="${escapeShortcodeString(step.tooltip)}"`;
  }
  if (step.requirements && step.requirements.length > 0) {
    output += ` requirements="${step.requirements.join(',')}"`;
  }

  output += ` >}}{{< /${shortcodeName} >}}\n`;
  return output;
}

function formatConditionalBlock(block: JsonConditionalBlock, includeComments: boolean, indentLevel: number): string {
  const indent = '  '.repeat(indentLevel);
  let output = '';

  if (includeComments && block.description) {
    output += `${indent}<!-- Conditional: ${block.description} -->\n`;
  }

  output += `${indent}{{< interactive/conditional conditions="${block.conditions.join(',')}"`;
  if (block.display) {
    output += ` display="${block.display}"`;
  }
  output += ` >}}\n\n`;

  // whenTrue branch
  output += `${indent}{{< interactive/when-true >}}\n`;
  for (const childBlock of block.whenTrue) {
    output += formatBlockForWebsite(childBlock, includeComments, indentLevel + 1);
  }
  output += `${indent}{{< /interactive/when-true >}}\n\n`;

  // whenFalse branch
  output += `${indent}{{< interactive/when-false >}}\n`;
  for (const childBlock of block.whenFalse) {
    output += formatBlockForWebsite(childBlock, includeComments, indentLevel + 1);
  }
  output += `${indent}{{< /interactive/when-false >}}\n\n`;

  output += `${indent}{{< /interactive/conditional >}}\n\n`;
  return output;
}

function formatQuizBlock(block: JsonQuizBlock, indent: string): string {
  let output = '';

  output += `${indent}{{< interactive/quiz`;
  if (block.multiSelect) {
    output += ` multiSelect="true"`;
  }
  if (block.completionMode) {
    output += ` completionMode="${block.completionMode}"`;
  }
  if (block.maxAttempts) {
    output += ` maxAttempts="${block.maxAttempts}"`;
  }
  output += ` >}}\n`;
  output += `${indent}${block.question}\n\n`;

  for (const choice of block.choices) {
    output += `${indent}{{< interactive/choice id="${choice.id}"`;
    if (choice.correct) {
      output += ` correct="true"`;
    }
    if (choice.hint) {
      output += ` hint="${escapeShortcodeString(choice.hint)}"`;
    }
    output += ` >}}${choice.text}{{< /interactive/choice >}}\n`;
  }

  output += `${indent}{{< /interactive/quiz >}}\n\n`;
  return output;
}

function formatInputBlock(block: JsonInputBlock, indent: string): string {
  let output = '';

  output += `${indent}{{< interactive/input`;
  output += ` variableName="${block.variableName}"`;
  output += ` inputType="${block.inputType}"`;
  if (block.placeholder) {
    output += ` placeholder="${escapeShortcodeString(block.placeholder)}"`;
  }
  if (block.checkboxLabel) {
    output += ` checkboxLabel="${escapeShortcodeString(block.checkboxLabel)}"`;
  }
  if (block.required) {
    output += ` required="true"`;
  }
  if (block.pattern) {
    output += ` pattern="${escapeShortcodeString(block.pattern)}"`;
  }
  output += ` >}}\n`;
  output += `${indent}${block.prompt}\n`;
  output += `${indent}{{< /interactive/input >}}\n\n`;

  return output;
}

function formatImageBlock(block: JsonImageBlock, indent: string): string {
  let output = `${indent}{{< figure src="${block.src}"`;
  if (block.alt) {
    output += ` alt="${escapeShortcodeString(block.alt)}"`;
  }
  if (block.width) {
    output += ` width="${block.width}"`;
  }
  output += ` >}}\n\n`;
  return output;
}

function formatVideoBlock(block: JsonVideoBlock, indent: string): string {
  if (block.provider === 'youtube') {
    // Extract video ID from YouTube URL
    const videoId = extractYouTubeId(block.src);
    return `${indent}{{< youtube id="${videoId}" >}}\n\n`;
  }
  return `${indent}{{< video src="${block.src}" >}}\n\n`;
}

/**
 * Escape special characters for use in shortcode string parameters
 */
function escapeShortcodeString(text: string): string {
  return text
    .replace(/"/g, "'") // Convert double quotes to single quotes
    .replace(/\n/g, ' '); // Flatten newlines
}

/**
 * Generate a section ID from title
 */
function generateSectionId(title?: string): string {
  if (!title) {
    return `section-${Date.now()}`;
  }
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Extract YouTube video ID from URL
 */
function extractYouTubeId(url: string): string {
  const match = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([^&?/]+)/);
  return match ? match[1] : url;
}

/**
 * Copy guide as website shortcodes to clipboard
 */
export async function copyGuideForWebsite(guide: JsonGuide, options?: GuideWebsiteExportOptions): Promise<boolean> {
  try {
    const output = exportGuideForWebsite(guide, options);
    await navigator.clipboard.writeText(output);
    return true;
  } catch (error) {
    console.error('Failed to copy website shortcodes:', error);
    return false;
  }
}
