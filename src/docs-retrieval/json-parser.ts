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
import { renderMarkdown } from '@grafana/data';
import DOMPurify from 'dompurify';
import {
  hasAssistantEnabled,
  type JsonGuide,
  type JsonBlock,
  type JsonMarkdownBlock,
  type JsonHtmlBlock,
  type JsonSectionBlock,
  type JsonConditionalBlock,
  type JsonInteractiveBlock,
  type JsonMultistepBlock,
  type JsonGuidedBlock,
  type JsonImageBlock,
  type JsonVideoBlock,
  type JsonQuizBlock,
  type JsonAssistantBlock,
  type JsonInputBlock,
  type JsonStep,
  type AssistantProps,
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
      // For assistant blocks, extract context from adjacent sibling blocks
      // This helps the AI understand the educational purpose of the content
      let surroundingContext: SurroundingContext | undefined;
      if (block.type === 'assistant') {
        const prevBlock = i > 0 ? guide.blocks[i - 1] : undefined;
        const nextBlock = i < guide.blocks.length - 1 ? guide.blocks[i + 1] : undefined;

        const beforeContext = prevBlock ? extractContextFromBlock(prevBlock) : undefined;
        const afterContext = nextBlock ? extractContextFromBlock(nextBlock) : undefined;

        if (beforeContext || afterContext) {
          surroundingContext = {
            ...(beforeContext && { before: beforeContext }),
            ...(afterContext && { after: afterContext }),
          };
        }
      }

      const result = convertBlockToParsedElement(block, `blocks[${i}]`, baseUrl, surroundingContext);
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
 * Convert a JsonBlock to a ParsedElement by type.
 * Internal helper that handles the actual conversion without assistant wrapper logic.
 */
function convertBlockByType(
  block: JsonBlock,
  path: string,
  baseUrl?: string,
  surroundingContext?: SurroundingContext
): ConversionResult {
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
    case 'input':
      return convertInputBlock(block, path);
    case 'assistant':
      // Legacy wrapper format - pass surrounding context for better AI understanding
      return convertAssistantBlock(block, path, baseUrl, surroundingContext);
    default:
      return {
        element: null,
        warning: `Unknown block type at ${path}: ${(block as JsonBlock).type}`,
      };
  }
}

/**
 * Convert a JsonBlock to a ParsedElement.
 * Handles both attribute-based assistant (assistantEnabled: true) and legacy wrapper format.
 *
 * @param block - The block to convert
 * @param path - The JSON path for debugging
 * @param baseUrl - Optional base URL for resolving relative paths
 * @param surroundingContext - Optional context from sibling blocks (for assistant blocks)
 */
function convertBlockToParsedElement(
  block: JsonBlock,
  path: string,
  baseUrl?: string,
  surroundingContext?: SurroundingContext
): ConversionResult {
  // Check for attribute-based assistant customization (new format)
  if (hasAssistantEnabled(block)) {
    const assistantBlock = block as JsonBlock & AssistantProps;
    const innerResult = convertBlockByType(block, path, baseUrl, surroundingContext);

    if (innerResult.element) {
      // Wrap with assistant-block-wrapper
      const wrappedElement: ParsedElement = {
        type: 'assistant-block-wrapper',
        props: {
          assistantId: assistantBlock.assistantId || `${path}-assistant`,
          assistantType: assistantBlock.assistantType || 'query',
          defaultValue: extractDefaultValueFromBlock(block),
          blockType: block.type,
          // Pass surrounding context for better AI understanding
          ...(surroundingContext && { surroundingContext }),
        },
        children: [innerResult.element],
      };

      return {
        ...innerResult,
        element: wrappedElement,
        hasAssistant: true,
      };
    }

    return innerResult;
  }

  // Standard conversion (no assistant wrapper)
  return convertBlockByType(block, path, baseUrl, surroundingContext);
}

/**
 * Convert Markdown content to ParsedElement children.
 * SECURITY: Input is sanitized with DOMPurify before parsing (F1, F4).
 *
 * @public Exported for use in AssistantBlockWrapper to render customized content
 */
export function parseMarkdownToElements(content: string): ParsedElement[] {
  // SECURITY: Sanitize with a safe allowlist so basic HTML content survives while stripping dangerous markup
  const sanitizedContent = DOMPurify.sanitize(content, {
    ALLOWED_TAGS: MARKDOWN_ALLOWED_TAGS,
    ALLOWED_ATTR: MARKDOWN_ALLOWED_ATTR,
    KEEP_CONTENT: true,
  });

  const html = renderMarkdown(sanitizedContent);

  // Sanitize the HTML output (renderMarkdown may produce HTML that needs additional sanitization)
  const sanitizedHtml = sanitizeDocumentationHTML(html);

  // Parse HTML to ParsedElement[] using existing HTML parser
  const htmlResult = parseHTMLToComponents(sanitizedHtml);

  if (!htmlResult.isValid || !htmlResult.data?.elements?.length) {
    // Fallback: return empty array or single paragraph with text
    return [
      {
        type: 'p',
        props: {},
        children: [sanitizedContent],
      },
    ];
  }

  return htmlResult.data.elements;
}

/**
 * Convert inline Markdown to HTML.
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

  const html = renderMarkdown(sanitizedInput);

  // SECURITY: Sanitize HTML output to prevent XSS attacks (F1, F4)
  // This is defense-in-depth - targetComment is also sanitized at render time,
  // but sanitizing here ensures safety at the source
  return sanitizeDocumentationHTML(html);
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
        warning: 'HTML blocks should be migrated to markdown/JSON blocks for better maintainability',
        hasInteractive: false,
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
      warning: 'HTML blocks should be migrated to markdown/JSON blocks for better maintainability',
      hasInteractive: false,
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
        display: block.display ?? 'inline',
        reftarget: block.reftarget,
        // Per-branch section configs (each branch has its own title, requirements, objectives)
        whenTrueSectionConfig: block.whenTrueSectionConfig,
        whenFalseSectionConfig: block.whenFalseSectionConfig,
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
    // Parse tooltip markdown and extract children (for inline rendering)
    const tooltipElements = parseMarkdownToElements(block.tooltip);
    const tooltipChildren = tooltipElements.flatMap((el) => (el.children ? el.children : [el]));
    const tooltipElement: ParsedElement = {
      type: 'span',
      props: { className: 'interactive-comment' },
      children: tooltipChildren,
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
        formHint: block.formHint,
        validateInput: block.validateInput,
        // Button visibility - default to true if not specified
        showMe: block.showMe ?? true,
        doIt: block.doIt ?? true,
        // Execution control
        completeEarly: block.completeEarly ?? false,
        postVerify: block.verify,
        // Lazy render support for virtualized containers
        lazyRender: block.lazyRender ?? false,
        scrollContainer: block.scrollContainer,
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
          start: block.start,
          end: block.end,
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
        start: block.start,
        end: block.end,
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

  // Build choices (textElements removed - not used by quiz component)
  const choices = block.choices.map((choice) => ({
    id: choice.id,
    text: choice.text,
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

function convertInputBlock(block: JsonInputBlock, path: string): ConversionResult {
  // Parse prompt as markdown for the content
  const promptElements = parseMarkdownToElements(block.prompt);

  // Convert requirements array to comma-separated string
  const requirements = block.requirements?.join(',') || undefined;

  return {
    element: {
      type: 'input-block',
      props: {
        prompt: block.prompt,
        inputType: block.inputType,
        variableName: block.variableName,
        placeholder: block.placeholder,
        checkboxLabel: block.checkboxLabel,
        defaultValue: block.defaultValue,
        required: block.required ?? false,
        pattern: block.pattern,
        validationMessage: block.validationMessage,
        requirements,
        skippable: block.skippable ?? false,
        datasourceFilter: block.datasourceFilter,
      },
      children: promptElements,
    },
    hasInteractive: true,
  };
}

/**
 * Extract the customizable default value from a block based on its type.
 * This value is what gets stored in localStorage and customized by the assistant.
 *
 * For multistep/guided blocks, extracts all step targetvalues (queries) and joins them.
 * This gives the assistant context about all the queries in the block.
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
    case 'guided': {
      // Extract all step targetvalues (queries) for better assistant context
      const stepQueries = block.steps
        .filter((step) => step.targetvalue)
        .map((step) => step.targetvalue)
        .filter((value): value is string => value !== undefined);

      if (stepQueries.length > 0) {
        // If we have step queries, combine them with the content
        // Format: content + queries (useful for assistant to customize all)
        const queriesText = stepQueries.join('\n');
        return block.content ? `${block.content}\n\nQueries:\n${queriesText}` : queriesText;
      }
      return block.content;
    }
    case 'quiz':
      return block.question;
    case 'input':
      return block.prompt;
    case 'section':
      // Sections contain nested blocks - extract from title if available
      return block.title || '';
    case 'image':
      // Images have alt text which could be customized
      return block.alt || '';
    case 'video':
      // Videos have title which could be customized
      return block.title || '';
    default:
      return '';
  }
}

/**
 * Extract readable context text from a block for assistant prompts.
 * Strips markdown syntax and returns plain text summary.
 * Used to provide surrounding context to help the assistant understand the purpose of a step.
 *
 * @param block - The block to extract context from
 * @returns Plain text context string, or undefined if block has no useful context
 */
function extractContextFromBlock(block: JsonBlock): string | undefined {
  if (block.type === 'markdown' || block.type === 'html') {
    // Strip markdown headings and normalize whitespace
    return block.content
      .replace(/#{1,6}\s*/g, '') // Remove heading markers
      .replace(/\*\*([^*]+)\*\*/g, '$1') // Remove bold markers
      .replace(/_([^_]+)_/g, '$1') // Remove italic markers
      .replace(/`([^`]+)`/g, '$1') // Remove inline code markers
      .replace(/```[\s\S]*?```/g, '') // Remove code blocks
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Convert links to text
      .replace(/\n+/g, ' ') // Normalize newlines to spaces
      .trim();
  }
  return undefined;
}

/** Surrounding context for assistant blocks */
interface SurroundingContext {
  before?: string;
  after?: string;
}

/**
 * Convert assistant wrapper block to wrapped child blocks.
 * Each child block gets its own assistant-customizable wrapper.
 * Enables AI-powered customization of content based on user's datasources.
 *
 * @param block - The assistant block to convert
 * @param path - The JSON path for debugging
 * @param baseUrl - Optional base URL for resolving relative paths
 * @param surroundingContext - Optional context from sibling blocks
 */
function convertAssistantBlock(
  block: JsonAssistantBlock,
  path: string,
  baseUrl?: string,
  surroundingContext?: SurroundingContext
): ConversionResult {
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
      // Wrap with assistant-block-wrapper, including surrounding context for better AI understanding
      const wrappedElement: ParsedElement = {
        type: 'assistant-block-wrapper',
        props: {
          assistantId: `${block.assistantId || path}-${i}`,
          assistantType: block.assistantType || 'query',
          defaultValue: extractDefaultValueFromBlock(childBlock),
          blockType: childBlock.type,
          // Pass surrounding context if available (helps assistant understand purpose)
          ...(surroundingContext && { surroundingContext }),
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
