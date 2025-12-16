/**
 * JSON Guide Parser
 *
 * Converts JSON-based guides to ParsedElement[] for rendering through
 * the existing content pipeline. Produces identical output to the HTML parser.
 */

import { ContentParseResult, ParsedContent, ParsedElement, ParseError } from './content.types';
import { parseHTMLToComponents } from './html-parser';
import { validateGuide } from '../validation';
import { sanitizeDocumentationHTML } from '../security/html-sanitizer';
import DOMPurify from 'dompurify';
import type {
  JsonGuide,
  JsonBlock,
  JsonMarkdownBlock,
  JsonHtmlBlock,
  JsonSectionBlock,
  JsonConditionalBlock,
  JsonInteractiveBlock,
  JsonMultistepBlock,
  JsonGuidedBlock,
  JsonImageBlock,
  JsonVideoBlock,
  JsonQuizBlock,
  JsonAssistantBlock,
  JsonStep,
} from '../types/json-guide.types';

const MARKDOWN_ALLOWED_TAGS = [
  'div',
  'span',
  'p',
  'ul',
  'ol',
  'li',
  'strong',
  'em',
  'code',
  'pre',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'img',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'br',
  'hr',
  'a',
];

const MARKDOWN_ALLOWED_ATTR = [
  'href',
  'title',
  'target',
  'rel',
  'src',
  'alt',
  'colspan',
  'rowspan',
  'class',
  'id',
  'width',
  'height',
];

const HTML_TAG_PATTERN = /<\s*\/?\s*[a-zA-Z][^>]*>/;

/**
 * Parse a JSON guide into ContentParseResult.
 *
 * @param input - JSON string or JsonGuide object
 * @param baseUrl - Base URL for the guide (used for security validation)
 * @returns ContentParseResult compatible with the HTML parser output
 */
export function parseJsonGuide(input: string | JsonGuide, baseUrl?: string): ContentParseResult {
  const errors: ParseError[] = [];
  const warnings: string[] = [];

  // Parse JSON string if needed
  let guide: JsonGuide;
  try {
    guide = typeof input === 'string' ? JSON.parse(input) : input;
  } catch (e) {
    errors.push({
      type: 'html_parsing',
      message: `Invalid JSON: ${e instanceof Error ? e.message : 'Unknown error'}`,
      originalError: e instanceof Error ? e : undefined,
    });
    return { isValid: false, errors, warnings };
  }

  // Zod validation replaces manual checks
  const validationResult = validateGuide(guide);
  if (!validationResult.isValid) {
    return {
      isValid: false,
      errors: validationResult.errors.map((e) => ({
        type: 'schema_validation',
        message: e.message,
        location: e.path.join('.'),
      })),
      warnings: validationResult.warnings.map((w) => w.message),
    };
  }

  // Preserve validation warnings (e.g., unknown fields, invalid condition syntax)
  warnings.push(...validationResult.warnings.map((w) => w.message));

  // Convert blocks to ParsedElements
  const elements: ParsedElement[] = [];
  let hasInteractiveElements = false;
  let hasCodeBlocks = false;
  let hasImages = false;
  let hasVideos = false;
  let hasAssistantElements = false;

  for (let i = 0; i < guide.blocks.length; i++) {
    const block = guide.blocks[i];
    try {
      const result = convertBlockToParsedElement(block, `blocks[${i}]`, baseUrl);
      if (result.element) {
        elements.push(result.element);
      }
      if (result.hasInteractive) {
        hasInteractiveElements = true;
      }
      if (result.hasCode) {
        hasCodeBlocks = true;
      }
      if (result.hasImage) {
        hasImages = true;
      }
      if (result.hasVideo) {
        hasVideos = true;
      }
      if (result.hasAssistant) {
        hasAssistantElements = true;
      }
      if (result.warning) {
        warnings.push(result.warning);
      }
    } catch (e) {
      errors.push({
        type: 'element_creation',
        message: `Failed to convert block ${i}: ${e instanceof Error ? e.message : 'Unknown error'}`,
        location: `blocks[${i}]`,
        originalError: e instanceof Error ? e : undefined,
      });
    }
  }

  const parsedContent: ParsedContent = {
    elements,
    hasInteractiveElements,
    hasCodeBlocks,
    hasExpandableTables: false,
    hasImages,
    hasVideos,
    hasAssistantElements,
  };

  return {
    isValid: errors.length === 0,
    data: parsedContent,
    errors,
    warnings,
  };
}

interface ConversionResult {
  element: ParsedElement | null;
  hasInteractive?: boolean;
  hasCode?: boolean;
  hasImage?: boolean;
  hasVideo?: boolean;
  hasAssistant?: boolean;
  warning?: string;
}

/**
 * Convert a JsonBlock to a ParsedElement.
 */
function convertBlockToParsedElement(block: JsonBlock, path: string, baseUrl?: string): ConversionResult {
  switch (block.type) {
    case 'markdown':
      return convertMarkdownBlock(block, path);
    case 'html':
      return convertHtmlBlock(block, path, baseUrl);
    case 'section':
      return convertSectionBlock(block, path, baseUrl);
    case 'conditional':
      return convertConditionalBlock(block, path, baseUrl);
    case 'interactive':
      return convertInteractiveBlock(block, path);
    case 'multistep':
      return convertMultistepBlock(block, path);
    case 'guided':
      return convertGuidedBlock(block, path);
    case 'image':
      return convertImageBlock(block, path, baseUrl);
    case 'video':
      return convertVideoBlock(block, path);
    case 'quiz':
      return convertQuizBlock(block, path);
    case 'assistant':
      return convertAssistantBlock(block, path, baseUrl);
    default:
      return {
        element: null,
        warning: `Unknown block type at ${path}: ${(block as JsonBlock).type}`,
      };
  }
}

/**
 * Convert markdown content to ParsedElement children.
 * Handles basic markdown syntax: headings, bold, italic, code, links, lists, code blocks, tables.
 * SECURITY: Input is sanitized with a safe allowlist of structural tags before parsing (F1, F4).
 * We allow basic content tags (div, span, headings, lists, tables, code) while stripping scripts/events.
 */
function parseMarkdownToElements(content: string): ParsedElement[] {
  // SECURITY: Sanitize with a safe allowlist so basic HTML content survives while stripping dangerous markup
  const sanitizedContent = DOMPurify.sanitize(content, {
    ALLOWED_TAGS: MARKDOWN_ALLOWED_TAGS,
    ALLOWED_ATTR: MARKDOWN_ALLOWED_ATTR,
    KEEP_CONTENT: true,
  });

  // If the content includes HTML tags after sanitization, try parsing as HTML to preserve allowed structure
  if (HTML_TAG_PATTERN.test(sanitizedContent)) {
    const htmlResult = parseHTMLToComponents(sanitizeDocumentationHTML(sanitizedContent));
    if (htmlResult.isValid && htmlResult.data?.elements?.length) {
      return htmlResult.data.elements;
    }
  }

  const elements: ParsedElement[] = [];
  const lines = sanitizedContent.split('\n');
  let currentList: ParsedElement | null = null;
  let currentListItems: ParsedElement[] = [];
  let inCodeBlock = false;
  let codeBlockLanguage = '';
  let codeBlockLines: string[] = [];
  let inTable = false;
  let tableHeaders: string[] = [];
  let tableRows: string[][] = [];

  const flushList = () => {
    if (currentList && currentListItems.length > 0) {
      currentList.children = currentListItems;
      elements.push(currentList);
      currentList = null;
      currentListItems = [];
    }
  };

  const flushCodeBlock = () => {
    if (codeBlockLines.length > 0) {
      // Use the code-block type to get the CodeBlock component with copy button and syntax highlighting
      elements.push({
        type: 'code-block',
        props: {
          code: codeBlockLines.join('\n'),
          language: codeBlockLanguage || undefined,
          showCopy: true,
          inline: false,
        },
        children: [],
      });
      codeBlockLines = [];
      codeBlockLanguage = '';
    }
  };

  const flushTable = () => {
    if (tableHeaders.length > 0 || tableRows.length > 0) {
      const headerCells: ParsedElement[] = tableHeaders.map((cell) => ({
        type: 'th',
        props: {},
        children: parseInlineMarkdown(cell.trim()),
      }));

      const bodyRows: ParsedElement[] = tableRows.map((row) => ({
        type: 'tr',
        props: {},
        children: row.map((cell) => ({
          type: 'td',
          props: {},
          children: parseInlineMarkdown(cell.trim()),
        })),
      }));

      const tableElement: ParsedElement = {
        type: 'table',
        props: {},
        children: [
          {
            type: 'thead',
            props: {},
            children: [
              {
                type: 'tr',
                props: {},
                children: headerCells,
              },
            ],
          },
          {
            type: 'tbody',
            props: {},
            children: bodyRows,
          },
        ],
      };

      elements.push(tableElement);
      tableHeaders = [];
      tableRows = [];
      inTable = false;
    }
  };

  // Helper to parse table row cells
  const parseTableRow = (line: string): string[] => {
    // Remove leading/trailing pipes and split by pipe
    const trimmed = line.trim();
    const withoutLeadingPipe = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed;
    const withoutTrailingPipe = withoutLeadingPipe.endsWith('|') ? withoutLeadingPipe.slice(0, -1) : withoutLeadingPipe;
    return withoutTrailingPipe.split('|');
  };

  // Helper to check if a line is a table separator (|---|---|)
  const isTableSeparator = (line: string): boolean => {
    const trimmed = line.trim();
    // Must contain | and only |, -, :, and spaces
    return trimmed.includes('|') && /^[\s|:\-]+$/.test(trimmed);
  };

  // Helper to check if a line looks like a table row
  const isTableRow = (line: string): boolean => {
    const trimmed = line.trim();
    return trimmed.includes('|') && !isTableSeparator(trimmed);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // Check for fenced code block start/end
    if (trimmedLine.startsWith('```')) {
      if (inCodeBlock) {
        // End of code block
        flushCodeBlock();
        inCodeBlock = false;
      } else {
        // Start of code block
        flushList();
        flushTable();
        inCodeBlock = true;
        codeBlockLanguage = trimmedLine.slice(3).trim();
      }
      continue;
    }

    // If we're inside a code block, collect the lines
    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    // Table handling
    if (isTableRow(trimmedLine)) {
      flushList();

      if (!inTable) {
        // This could be the header row - check if next line is separator
        const nextLine = lines[i + 1]?.trim() || '';
        if (isTableSeparator(nextLine)) {
          // Start of table - this is the header
          inTable = true;
          tableHeaders = parseTableRow(trimmedLine);
          i++; // Skip the separator line
          continue;
        }
      }

      if (inTable) {
        // This is a body row
        tableRows.push(parseTableRow(trimmedLine));
        continue;
      }
    } else if (inTable) {
      // End of table (non-table line encountered)
      flushTable();
    }

    // Skip empty lines (but flush lists and tables)
    if (trimmedLine === '') {
      flushList();
      flushTable();
      continue;
    }

    // Headings
    const headingMatch = trimmedLine.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushList();
      flushTable();
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      elements.push({
        type: `h${level}`,
        props: {},
        children: parseInlineMarkdown(text),
      });
      continue;
    }

    // Unordered list items
    if (trimmedLine.startsWith('- ') || trimmedLine.startsWith('* ')) {
      flushTable();
      if (!currentList) {
        currentList = { type: 'ul', props: {}, children: [] };
      }
      currentListItems.push({
        type: 'li',
        props: {},
        children: parseInlineMarkdown(trimmedLine.slice(2)),
      });
      continue;
    }

    // Ordered list items
    const orderedMatch = trimmedLine.match(/^(\d+)\.\s+(.+)$/);
    if (orderedMatch) {
      flushTable();
      if (!currentList || currentList.type !== 'ol') {
        flushList();
        currentList = { type: 'ol', props: {}, children: [] };
      }
      currentListItems.push({
        type: 'li',
        props: {},
        children: parseInlineMarkdown(orderedMatch[2]),
      });
      continue;
    }

    // Regular paragraph
    flushList();
    flushTable();
    elements.push({
      type: 'p',
      props: {},
      children: parseInlineMarkdown(trimmedLine),
    });
  }

  // Flush any remaining list, code block, or table
  flushList();
  flushCodeBlock();
  flushTable();

  return elements;
}

/**
 * Convert inline markdown to HTML string.
 * Used for targetComment which expects HTML.
 * SECURITY: Output is sanitized with DOMPurify to prevent XSS attacks (F1, F4).
 */
function markdownToHtml(text: string): string {
  // SECURITY: Sanitize input with the same allowlist used for markdown parsing
  const sanitizedInput = DOMPurify.sanitize(text, {
    ALLOWED_TAGS: MARKDOWN_ALLOWED_TAGS,
    ALLOWED_ATTR: MARKDOWN_ALLOWED_ATTR,
    KEEP_CONTENT: true,
  });

  const html = sanitizedInput
    // Bold: **text** or __text__
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    // Italic: *text* or _text_ (but not inside words)
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/(?<!\w)_([^_]+)_(?!\w)/g, '<em>$1</em>')
    // Inline code: `code`
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Links: [text](url)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  // SECURITY: Sanitize HTML output to prevent XSS attacks (F1, F4)
  // This is defense-in-depth - targetComment is also sanitized at render time,
  // but sanitizing here ensures safety at the source
  return sanitizeDocumentationHTML(html);
}

/**
 * Parse inline markdown (bold, italic, code, links) into ParsedElement children.
 */
function parseInlineMarkdown(text: string): Array<ParsedElement | string> {
  const children: Array<ParsedElement | string> = [];
  let lastIndex = 0;

  // Combined regex to find any inline element
  const combinedRegex = /(\*\*(.+?)\*\*|__(.+?)__|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|\*([^*]+)\*|_([^_]+)_)/g;

  let match;
  while ((match = combinedRegex.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      const textBefore = text.slice(lastIndex, match.index);
      if (textBefore) {
        children.push(textBefore);
      }
    }

    const fullMatch = match[0];

    // Determine which pattern matched
    if (fullMatch.startsWith('**') || fullMatch.startsWith('__')) {
      // Bold
      const content = match[2] || match[3];
      children.push({
        type: 'strong',
        props: {},
        children: [content],
      });
    } else if (fullMatch.startsWith('`')) {
      // Inline code - use code-block type for consistent styling
      children.push({
        type: 'code-block',
        props: {
          code: match[4],
          showCopy: true,
          inline: true,
        },
        children: [],
      });
    } else if (fullMatch.startsWith('[')) {
      // Link
      children.push({
        type: 'a',
        props: { href: match[6], target: '_blank', rel: 'noopener noreferrer' },
        children: [match[5]],
      });
    } else if (fullMatch.startsWith('*') || fullMatch.startsWith('_')) {
      // Italic
      const content = match[7] || match[8];
      children.push({
        type: 'em',
        props: {},
        children: [content],
      });
    }

    lastIndex = match.index + fullMatch.length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex);
    if (remaining) {
      children.push(remaining);
    }
  }

  // If no patterns matched, return the original text
  if (children.length === 0) {
    return [text];
  }

  return children;
}

function convertMarkdownBlock(block: JsonMarkdownBlock, path: string): ConversionResult {
  const elements = parseMarkdownToElements(block.content);

  // If only one element, return it directly
  if (elements.length === 1) {
    return { element: elements[0] };
  }

  // Wrap multiple elements in a div
  return {
    element: {
      type: 'div',
      props: { className: 'markdown-block' },
      children: elements,
    },
  };
}

function convertHtmlBlock(block: JsonHtmlBlock, path: string, baseUrl?: string): ConversionResult {
  // Use the full HTML parser to support interactive elements, code blocks, etc.
  // The HTML parser handles sanitization internally via DOMPurify
  // Pass baseUrl so the parser knows interactive content is from a trusted source
  try {
    const parseResult = parseHTMLToComponents(block.content, baseUrl);

    if (!parseResult.isValid || !parseResult.data) {
      return {
        element: null,
        warning: `Failed to parse HTML block at ${path}: ${parseResult.errors?.map((e) => e.message).join(', ') || 'Unknown error'}`,
      };
    }

    const elements = parseResult.data.elements;

    // If no elements, return null
    if (elements.length === 0) {
      return {
        element: null,
        warning: `Empty HTML block at ${path}`,
      };
    }

    // If only one element, return it directly
    if (elements.length === 1) {
      return {
        element: elements[0],
        // Only show migration warning if no interactive elements detected
        warning: parseResult.data.hasInteractiveElements
          ? undefined
          : 'HTML blocks should be migrated to markdown/JSON blocks for better maintainability',
        hasInteractive: parseResult.data.hasInteractiveElements,
        hasCode: parseResult.data.hasCodeBlocks,
      };
    }

    // Wrap multiple elements in a div
    return {
      element: {
        type: 'div',
        props: { className: 'html-block' },
        children: elements,
      },
      warning: parseResult.data.hasInteractiveElements
        ? undefined
        : 'HTML blocks should be migrated to markdown/JSON blocks for better maintainability',
      hasInteractive: parseResult.data.hasInteractiveElements,
      hasCode: parseResult.data.hasCodeBlocks,
    };
  } catch (e) {
    return {
      element: null,
      warning: `Failed to parse HTML block at ${path}: ${e instanceof Error ? e.message : 'Unknown error'}`,
    };
  }
}

function convertSectionBlock(block: JsonSectionBlock, path: string, baseUrl?: string): ConversionResult {
  // Convert child blocks to step elements
  const children: ParsedElement[] = [];

  for (let i = 0; i < block.blocks.length; i++) {
    const childBlock = block.blocks[i];
    const result = convertBlockToParsedElement(childBlock, `${path}.blocks[${i}]`, baseUrl);
    if (result.element) {
      children.push(result.element);
    }
  }

  // Convert requirements array to comma-separated string (as expected by renderer)
  const requirements = block.requirements?.join(',') || undefined;
  const objectives = block.objectives?.join(',') || undefined;

  return {
    element: {
      type: 'interactive-section',
      props: {
        title: block.title,
        isSequence: true, // Sections are always sequences
        id: block.id,
        requirements,
        objectives,
      },
      children,
    },
    hasInteractive: true,
  };
}

/**
 * Convert a conditional block to a ParsedElement.
 * Conditional blocks show different content based on whether conditions pass or fail.
 */
function convertConditionalBlock(block: JsonConditionalBlock, path: string, baseUrl?: string): ConversionResult {
  // Convert whenTrue branch blocks
  const whenTrueChildren: ParsedElement[] = [];
  for (let i = 0; i < block.whenTrue.length; i++) {
    const childBlock = block.whenTrue[i];
    const result = convertBlockToParsedElement(childBlock, `${path}.whenTrue[${i}]`, baseUrl);
    if (result.element) {
      whenTrueChildren.push(result.element);
    }
  }

  // Convert whenFalse branch blocks
  const whenFalseChildren: ParsedElement[] = [];
  for (let i = 0; i < block.whenFalse.length; i++) {
    const childBlock = block.whenFalse[i];
    const result = convertBlockToParsedElement(childBlock, `${path}.whenFalse[${i}]`, baseUrl);
    if (result.element) {
      whenFalseChildren.push(result.element);
    }
  }

  return {
    element: {
      type: 'interactive-conditional',
      props: {
        conditions: block.conditions,
        description: block.description,
        // Store both branches in props - renderer will pick based on condition evaluation
        whenTrueChildren,
        whenFalseChildren,
      },
      children: [],
    },
    hasInteractive: true,
  };
}

function convertInteractiveBlock(block: JsonInteractiveBlock, path: string): ConversionResult {
  // Map 'action' to 'targetAction' for compatibility with existing components
  const targetAction = block.action;

  // Parse content as markdown for children
  const children = parseMarkdownToElements(block.content);

  // Add tooltip as interactive-comment if present
  if (block.tooltip) {
    const tooltipElement: ParsedElement = {
      type: 'span',
      props: { className: 'interactive-comment' },
      children: parseInlineMarkdown(block.tooltip),
    };
    children.unshift(tooltipElement);
  }

  // Convert requirements array to comma-separated string
  const requirements = block.requirements?.join(',') || undefined;
  const objectives = block.objectives?.join(',') || undefined;

  return {
    element: {
      type: 'interactive-step',
      props: {
        targetAction,
        refTarget: block.reftarget,
        targetValue: block.targetvalue,
        targetComment: block.tooltip ? markdownToHtml(block.tooltip) : undefined,
        requirements,
        objectives,
        skippable: block.skippable ?? false,
        hints: block.hint,
        // Button visibility - default to true if not specified
        showMe: block.showMe ?? true,
        doIt: block.doIt ?? true,
        // Execution control
        completeEarly: block.completeEarly ?? false,
        postVerify: block.verify,
      },
      children,
    },
    hasInteractive: true,
  };
}

function convertMultistepBlock(block: JsonMultistepBlock, path: string): ConversionResult {
  // Convert steps to internalActions format expected by renderer
  const internalActions = block.steps.map((step: JsonStep) => ({
    targetAction: step.action,
    refTarget: step.reftarget,
    targetValue: step.targetvalue,
    requirements: step.requirements?.join(','),
    targetComment: step.tooltip ? markdownToHtml(step.tooltip) : undefined,
  }));

  // Parse content as markdown for children
  const children = parseMarkdownToElements(block.content);

  // Convert requirements array to comma-separated string
  const requirements = block.requirements?.join(',') || undefined;
  const objectives = block.objectives?.join(',') || undefined;

  return {
    element: {
      type: 'interactive-multi-step',
      props: {
        internalActions,
        requirements,
        objectives,
        skippable: block.skippable ?? false,
      },
      children,
    },
    hasInteractive: true,
  };
}

function convertGuidedBlock(block: JsonGuidedBlock, path: string): ConversionResult {
  // Convert steps to internalActions format expected by renderer
  const internalActions = block.steps.map((step: JsonStep) => ({
    targetAction: step.action,
    refTarget: step.reftarget,
    targetValue: step.targetvalue,
    requirements: step.requirements?.join(','),
    // For guided blocks, prefer description (shown in steps panel), fall back to tooltip for backward compatibility
    targetComment: step.description
      ? markdownToHtml(step.description)
      : step.tooltip
        ? markdownToHtml(step.tooltip)
        : undefined,
    isSkippable: step.skippable ?? false,
    formHint: step.formHint, // Pass form hint for formfill validation feedback
    validateInput: step.validateInput, // Pass validation toggle for formfill
  }));

  // Parse content as markdown for children
  const children = parseMarkdownToElements(block.content);

  // Convert requirements array to comma-separated string
  const requirements = block.requirements?.join(',') || undefined;
  const objectives = block.objectives?.join(',') || undefined;

  return {
    element: {
      type: 'interactive-guided',
      props: {
        internalActions,
        stepTimeout: block.stepTimeout ?? 120000,
        requirements,
        objectives,
        skippable: block.skippable ?? false,
        completeEarly: block.completeEarly ?? false,
      },
      children,
    },
    hasInteractive: true,
  };
}

function convertImageBlock(block: JsonImageBlock, path: string, baseUrl?: string): ConversionResult {
  return {
    element: {
      type: 'image-renderer',
      props: {
        src: block.src,
        alt: block.alt,
        width: block.width,
        height: block.height,
        baseUrl,
      },
      children: [],
    },
    hasImage: true,
  };
}

function convertVideoBlock(block: JsonVideoBlock, path: string): ConversionResult {
  const isYouTube = block.provider === 'youtube' || block.src.includes('youtube.com') || block.src.includes('youtu.be');

  if (isYouTube) {
    return {
      element: {
        type: 'youtube-video',
        props: {
          src: block.src,
          title: block.title,
        },
        children: [],
      },
      hasVideo: true,
    };
  }

  return {
    element: {
      type: 'video',
      props: {
        src: block.src,
        title: block.title,
      },
      children: [],
    },
    hasVideo: true,
  };
}

function convertQuizBlock(block: JsonQuizBlock, path: string): ConversionResult {
  // Parse question as markdown for the content
  const questionElements = parseMarkdownToElements(block.question);

  // Convert requirements array to comma-separated string
  const requirements = block.requirements?.join(',') || undefined;

  // Build choices with parsed markdown text
  const choices = block.choices.map((choice) => ({
    id: choice.id,
    text: choice.text,
    textElements: parseInlineMarkdown(choice.text),
    correct: choice.correct ?? false,
    hint: choice.hint,
  }));

  return {
    element: {
      type: 'quiz-block',
      props: {
        question: block.question,
        choices,
        multiSelect: block.multiSelect ?? false,
        completionMode: block.completionMode ?? 'correct-only',
        maxAttempts: block.maxAttempts ?? 3,
        requirements,
        skippable: block.skippable ?? false,
      },
      children: questionElements,
    },
    hasInteractive: true,
  };
}

/**
 * Extract the customizable default value from a block based on its type.
 * This value is what gets stored in localStorage and customized by the assistant.
 */
function extractDefaultValueFromBlock(block: JsonBlock): string {
  switch (block.type) {
    case 'markdown':
    case 'html':
      return block.content;
    case 'interactive':
      // Prefer targetvalue for queries, fall back to content
      return block.targetvalue || block.content;
    case 'multistep':
    case 'guided':
      return block.content;
    case 'quiz':
      return block.question;
    default:
      return '';
  }
}

/**
 * Convert assistant wrapper block to wrapped child blocks.
 * Each child block gets its own assistant-customizable wrapper.
 * Enables AI-powered customization of content based on user's datasources.
 */
function convertAssistantBlock(block: JsonAssistantBlock, path: string, baseUrl?: string): ConversionResult {
  const wrappedChildren: ParsedElement[] = [];
  let hasInteractive = false;
  let hasCode = false;
  let hasImage = false;
  let hasVideo = false;

  for (let i = 0; i < block.blocks.length; i++) {
    const childBlock = block.blocks[i];
    const childPath = `${path}.blocks[${i}]`;

    // Convert child block normally
    const childResult = convertBlockToParsedElement(childBlock, childPath, baseUrl);

    if (childResult.element) {
      // Wrap with assistant-block-wrapper
      const wrappedElement: ParsedElement = {
        type: 'assistant-block-wrapper',
        props: {
          assistantId: `${block.assistantId || path}-${i}`,
          assistantType: block.assistantType || 'query',
          defaultValue: extractDefaultValueFromBlock(childBlock),
          blockType: childBlock.type,
        },
        children: [childResult.element],
      };
      wrappedChildren.push(wrappedElement);
    }

    if (childResult.hasInteractive) {
      hasInteractive = true;
    }
    if (childResult.hasCode) {
      hasCode = true;
    }
    if (childResult.hasImage) {
      hasImage = true;
    }
    if (childResult.hasVideo) {
      hasVideo = true;
    }
  }

  return {
    element: {
      type: 'div',
      props: { className: 'assistant-wrapper' },
      children: wrappedChildren,
    },
    hasAssistant: true,
    hasInteractive,
    hasCode,
    hasImage,
    hasVideo,
  };
}

/**
 * Check if content is a JSON guide (vs HTML).
 */
export function isJsonGuideContent(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed.startsWith('{')) {
    return false;
  }
  try {
    const parsed = JSON.parse(trimmed);
    // Check for required JsonGuide fields
    return typeof parsed.id === 'string' && typeof parsed.title === 'string' && Array.isArray(parsed.blocks);
  } catch {
    return false;
  }
}
