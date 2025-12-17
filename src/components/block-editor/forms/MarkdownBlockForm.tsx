/**
 * Markdown Block Form
 *
 * Rich WYSIWYG markdown editor using TipTap.
 * Stores content as markdown while providing rich editing experience.
 */

import React, { useState, useCallback, useMemo } from 'react';
import { Button, Field, IconButton, useStyles2, Menu, Dropdown, Switch, Select, Input } from '@grafana/ui';
import { GrafanaTheme2, SelectableValue } from '@grafana/data';
import { css } from '@emotion/css';
import { useEditor, EditorContent, Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { getBlockFormStyles } from '../block-editor.styles';
import type { BlockFormProps, JsonBlock } from '../types';
import type { JsonMarkdownBlock } from '../../../types/json-guide.types';

/** Assistant content type options */
const ASSISTANT_TYPE_OPTIONS: Array<SelectableValue<'query' | 'config' | 'code' | 'text'>> = [
  { value: 'query', label: 'Query', description: 'PromQL, LogQL, or other query languages' },
  { value: 'config', label: 'Configuration', description: 'Configuration values or settings' },
  { value: 'code', label: 'Code', description: 'Code snippets' },
  { value: 'text', label: 'Text', description: 'General text content' },
];

/**
 * Type guard for markdown blocks
 */
function isMarkdownBlock(block: JsonBlock): block is JsonMarkdownBlock {
  return block.type === 'markdown';
}

// ============================================================================
// Markdown ↔ HTML Converters
// ============================================================================

/**
 * Convert markdown to HTML for TipTap editor
 * Uses placeholder tokens to protect code blocks from other transformations
 */
function markdownToHtml(markdown: string): string {
  if (!markdown.trim()) {
    return '<p></p>';
  }

  // Store code blocks with placeholders to protect them
  const codeBlocks: string[] = [];
  const inlineCodes: string[] = [];

  let html = markdown;

  // Extract and protect code blocks first (handles ``` with or without language)
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, lang, code) => {
    // Trim the code content to remove leading/trailing whitespace
    const trimmedCode = code.trim();
    const escaped = trimmedCode.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const langAttr = lang ? ` class="language-${lang}"` : '';
    codeBlocks.push(`<pre><code${langAttr}>${escaped}</code></pre>`);
    return `%%CODEBLOCK_${codeBlocks.length - 1}%%`;
  });

  // Extract and protect inline code
  html = html.replace(/`([^`\n]+)`/g, (_match, code) => {
    const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    inlineCodes.push(`<code>${escaped}</code>`);
    return `%%INLINECODE_${inlineCodes.length - 1}%%`;
  });

  // Now escape remaining HTML
  html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Headers (in order of precedence)
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Bold and italic (order matters)
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Horizontal rules
  html = html.replace(/^---$/gm, '<hr>');

  // Blockquotes
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote><p>$1</p></blockquote>');

  // Process line by line for lists and paragraphs
  const lines = html.split('\n');
  const result: string[] = [];
  let inUl = false;
  let inOl = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines but close any open lists
    if (!trimmed) {
      if (inUl) {
        result.push('</ul>');
        inUl = false;
      }
      if (inOl) {
        result.push('</ol>');
        inOl = false;
      }
      continue;
    }

    // Check for list items
    const ulMatch = trimmed.match(/^[\-\*] (.+)$/);
    const olMatch = trimmed.match(/^\d+\. (.+)$/);

    if (ulMatch) {
      if (inOl) {
        result.push('</ol>');
        inOl = false;
      }
      if (!inUl) {
        result.push('<ul>');
        inUl = true;
      }
      result.push(`<li><p>${ulMatch[1]}</p></li>`);
    } else if (olMatch) {
      if (inUl) {
        result.push('</ul>');
        inUl = false;
      }
      if (!inOl) {
        result.push('<ol>');
        inOl = true;
      }
      result.push(`<li><p>${olMatch[1]}</p></li>`);
    } else {
      // Close any open lists
      if (inUl) {
        result.push('</ul>');
        inUl = false;
      }
      if (inOl) {
        result.push('</ol>');
        inOl = false;
      }

      // Check if already wrapped in block element or is a placeholder
      if (
        trimmed.startsWith('<h') ||
        trimmed.startsWith('<hr') ||
        trimmed.startsWith('<blockquote') ||
        trimmed.startsWith('%%CODEBLOCK_')
      ) {
        result.push(trimmed);
      } else {
        result.push(`<p>${trimmed}</p>`);
      }
    }
  }

  // Close any remaining open lists
  if (inUl) {
    result.push('</ul>');
  }
  if (inOl) {
    result.push('</ol>');
  }

  html = result.join('');

  // Restore code blocks and inline code
  codeBlocks.forEach((block, i) => {
    html = html.replace(`%%CODEBLOCK_${i}%%`, block);
    // Also handle if it got wrapped in <p>
    html = html.replace(`<p>%%CODEBLOCK_${i}%%</p>`, block);
  });

  inlineCodes.forEach((code, i) => {
    html = html.replace(new RegExp(`%%INLINECODE_${i}%%`, 'g'), code);
  });

  return html || '<p></p>';
}

/**
 * Convert HTML from TipTap to markdown
 * Handles TipTap's specific HTML output format
 */
function htmlToMarkdown(html: string): string {
  if (!html.trim()) {
    return '';
  }

  let md = html;

  // First, handle code blocks - TipTap wraps them in <pre><code>
  // The code content may have HTML entities that need decoding
  md = md.replace(/<pre><code(?:\s+class="language-(\w+)")?>([\s\S]*?)<\/code><\/pre>/gi, (_match, lang, code) => {
    // Decode HTML entities in code
    const decoded = code
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&nbsp;/g, ' ')
      .trim(); // Remove leading/trailing whitespace from code content
    const langTag = lang || '';
    return `\`\`\`${langTag}\n${decoded}\n\`\`\``;
  });

  // Handle inline code - must be after code blocks
  md = md.replace(/<code>([^<]*)<\/code>/gi, (_match, code) => {
    const decoded = code.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    return `\`${decoded}\``;
  });

  // Headers - TipTap may include content with nested tags
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_m, content) => `# ${stripTags(content)}\n\n`);
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_m, content) => `## ${stripTags(content)}\n\n`);
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_m, content) => `### ${stripTags(content)}\n\n`);
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_m, content) => `#### ${stripTags(content)}\n\n`);

  // Bold and italic - handle nested cases
  md = md.replace(/<strong><em>([\s\S]*?)<\/em><\/strong>/gi, '***$1***');
  md = md.replace(/<em><strong>([\s\S]*?)<\/strong><\/em>/gi, '***$1***');
  md = md.replace(/<strong>([\s\S]*?)<\/strong>/gi, '**$1**');
  md = md.replace(/<em>([\s\S]*?)<\/em>/gi, '*$1*');

  // Links
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

  // Horizontal rules
  md = md.replace(/<hr\s*\/?>/gi, '\n---\n');

  // Blockquotes - TipTap nests paragraphs inside
  md = md.replace(/<blockquote>([\s\S]*?)<\/blockquote>/gi, (_match, content) => {
    const text = stripTags(content).trim();
    return `> ${text}\n\n`;
  });

  // Lists - handle TipTap's structure with nested p tags
  md = md.replace(/<ul>([\s\S]*?)<\/ul>/gi, (_match, content: string) => {
    const items = content.match(/<li[^>]*>([\s\S]*?)<\/li>/gi) || [];
    return (
      items
        .map((item) => {
          const text = stripTags(item.replace(/<\/?li[^>]*>/gi, '')).trim();
          return `- ${text}`;
        })
        .join('\n') + '\n\n'
    );
  });

  md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_match, content: string) => {
    const items = content.match(/<li[^>]*>([\s\S]*?)<\/li>/gi) || [];
    return (
      items
        .map((item, i) => {
          const text = stripTags(item.replace(/<\/?li[^>]*>/gi, '')).trim();
          return `${i + 1}. ${text}`;
        })
        .join('\n') + '\n\n'
    );
  });

  // Paragraphs
  md = md.replace(/<p>([\s\S]*?)<\/p>/gi, '$1\n\n');

  // Line breaks
  md = md.replace(/<br\s*\/?>/gi, '\n');

  // Clean up any remaining tags
  md = md.replace(/<[^>]+>/g, '');

  // Decode remaining HTML entities
  md = md.replace(/&amp;/g, '&');
  md = md.replace(/&lt;/g, '<');
  md = md.replace(/&gt;/g, '>');
  md = md.replace(/&nbsp;/g, ' ');
  md = md.replace(/&quot;/g, '"');

  // Clean up excessive whitespace
  md = md.replace(/\n{3,}/g, '\n\n').trim();

  return md;
}

/**
 * Strip HTML tags from content, preserving text
 */
function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

// ============================================================================
// Editor Toolbar Component
// ============================================================================

interface ToolbarProps {
  editor: Editor | null;
  /** Force re-render counter - incremented on editor transactions */
  updateKey?: number;
}

const getToolbarStyles = (theme: GrafanaTheme2) => ({
  toolbar: css({
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(0.5),
    padding: theme.spacing(1),
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    backgroundColor: theme.colors.background.secondary,
    alignItems: 'center',
  }),
  buttonGroup: css({
    display: 'flex',
    gap: theme.spacing(0.25),
    paddingRight: theme.spacing(1),
    borderRight: `1px solid ${theme.colors.border.weak}`,

    '&:last-child': {
      borderRight: 'none',
      paddingRight: 0,
    },
  }),
  formatButton: css({
    minWidth: '32px',
    height: '32px',
    padding: '0 8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: theme.shape.radius.default,
    color: theme.colors.text.secondary,
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 600,
    transition: 'all 0.15s ease',

    '&:hover': {
      backgroundColor: theme.colors.action.hover,
      color: theme.colors.text.primary,
    },

    '&:disabled': {
      opacity: 0.5,
      cursor: 'not-allowed',
    },
  }),
  formatButtonActive: css({
    backgroundColor: theme.colors.primary.main,
    color: theme.colors.primary.contrastText,

    '&:hover': {
      backgroundColor: theme.colors.primary.shade,
    },
  }),
});

function EditorToolbar({ editor, updateKey: _updateKey }: ToolbarProps) {
  const styles = useStyles2(getToolbarStyles);

  if (!editor) {
    return null;
  }

  // Check current block type - order matters (check headings first)
  const isHeading1 = editor.isActive('heading', { level: 1 });
  const isHeading2 = editor.isActive('heading', { level: 2 });
  const isHeading3 = editor.isActive('heading', { level: 3 });

  const getCurrentStyle = (): string => {
    if (isHeading1) {
      return 'Heading 1';
    }
    if (isHeading2) {
      return 'Heading 2';
    }
    if (isHeading3) {
      return 'Heading 3';
    }
    return 'Paragraph';
  };

  const renderStyleMenu = () => (
    <Menu>
      <Menu.Item
        label="Paragraph"
        icon={editor.isActive('paragraph') ? 'check' : undefined}
        onClick={() => editor.chain().focus().setParagraph().run()}
      />
      <Menu.Item
        label="Heading 1"
        icon={editor.isActive('heading', { level: 1 }) ? 'check' : undefined}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      />
      <Menu.Item
        label="Heading 2"
        icon={editor.isActive('heading', { level: 2 }) ? 'check' : undefined}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      />
      <Menu.Item
        label="Heading 3"
        icon={editor.isActive('heading', { level: 3 }) ? 'check' : undefined}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      />
    </Menu>
  );

  return (
    <div className={styles.toolbar}>
      {/* Undo/Redo */}
      <div className={styles.buttonGroup}>
        <IconButton
          name="history-alt"
          tooltip="Undo"
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          size="md"
          aria-label="Undo"
        />
        <IconButton
          name="repeat"
          tooltip="Redo"
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          size="md"
          aria-label="Redo"
        />
      </div>

      {/* Heading Style Dropdown */}
      <div className={styles.buttonGroup}>
        <Dropdown overlay={renderStyleMenu} placement="bottom-start">
          <Button variant="secondary" size="sm" icon="angle-down">
            {getCurrentStyle()}
          </Button>
        </Dropdown>
      </div>

      {/* Text Formatting */}
      <div className={styles.buttonGroup}>
        <button
          type="button"
          className={`${styles.formatButton} ${editor.isActive('bold') ? styles.formatButtonActive : ''}`}
          onClick={() => editor.chain().focus().toggleBold().run()}
          title="Bold (Ctrl+B)"
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          className={`${styles.formatButton} ${editor.isActive('italic') ? styles.formatButtonActive : ''}`}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          title="Italic (Ctrl+I)"
          style={{ fontStyle: 'italic' }}
        >
          I
        </button>
        <IconButton
          name="brackets-curly"
          tooltip="Code"
          onClick={() => editor.chain().focus().toggleCode().run()}
          variant={editor.isActive('code') ? 'primary' : 'secondary'}
          size="md"
          aria-label="Code"
        />
      </div>

      {/* Lists */}
      <div className={styles.buttonGroup}>
        <IconButton
          name="list-ul"
          tooltip="Bullet List"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          variant={editor.isActive('bulletList') ? 'primary' : 'secondary'}
          size="md"
          aria-label="Bullet List"
        />
        <IconButton
          name="list-ol"
          tooltip="Numbered List"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          variant={editor.isActive('orderedList') ? 'primary' : 'secondary'}
          size="md"
          aria-label="Numbered List"
        />
      </div>

      {/* Block Elements */}
      <div className={styles.buttonGroup}>
        <IconButton
          name="comment-alt"
          tooltip="Blockquote"
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          variant={editor.isActive('blockquote') ? 'primary' : 'secondary'}
          size="md"
          aria-label="Blockquote"
        />
        <IconButton
          name="document-info"
          tooltip="Code Block"
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          variant={editor.isActive('codeBlock') ? 'primary' : 'secondary'}
          size="md"
          aria-label="Code Block"
        />
        <IconButton
          name="minus"
          tooltip="Horizontal Rule"
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          size="md"
          aria-label="Horizontal Rule"
        />
      </div>

      {/* Clear Formatting */}
      <div className={styles.buttonGroup}>
        <IconButton
          name="trash-alt"
          tooltip="Clear Formatting"
          onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}
          size="md"
          aria-label="Clear Formatting"
        />
      </div>
    </div>
  );
}

// ============================================================================
// Editor Styles
// ============================================================================

const getEditorStyles = (theme: GrafanaTheme2) => ({
  container: css({
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    overflow: 'hidden',
    backgroundColor: theme.colors.background.primary,

    '&:focus-within': {
      borderColor: theme.colors.primary.border,
      boxShadow: `0 0 0 1px ${theme.colors.primary.border}`,
    },
  }),
  modeTabs: css({
    display: 'flex',
    backgroundColor: theme.colors.background.secondary,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
  }),
  modeTab: css({
    padding: `${theme.spacing(1)} ${theme.spacing(2)}`,
    border: 'none',
    backgroundColor: 'transparent',
    color: theme.colors.text.secondary,
    cursor: 'pointer',
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    borderBottom: '2px solid transparent',
    marginBottom: '-1px',
    transition: 'all 0.15s ease',
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),

    '&:hover': {
      color: theme.colors.text.primary,
      backgroundColor: theme.colors.action.hover,
    },
  }),
  modeTabActive: css({
    color: theme.colors.text.primary,
    borderBottomColor: theme.colors.primary.main,
  }),
  rawTextarea: css({
    width: '100%',
    minHeight: '250px',
    maxHeight: '400px',
    padding: theme.spacing(1.5),
    border: 'none',
    outline: 'none',
    resize: 'vertical',
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.body.fontSize,
    lineHeight: 1.6,
    backgroundColor: 'transparent',
    color: theme.colors.text.primary,
    overflowY: 'auto',

    '&::placeholder': {
      color: theme.colors.text.disabled,
    },
  }),
  editorContent: css({
    minHeight: '250px',
    maxHeight: '400px',
    overflowY: 'auto',
    padding: theme.spacing(1.5),

    // TipTap/ProseMirror styling
    '& .ProseMirror': {
      outline: 'none',
      minHeight: '220px',

      '& > * + *': {
        marginTop: theme.spacing(1),
      },

      '& h1': {
        fontSize: theme.typography.h1.fontSize,
        fontWeight: theme.typography.h1.fontWeight,
        marginTop: theme.spacing(2),
        marginBottom: theme.spacing(1),
      },

      '& h2': {
        fontSize: theme.typography.h2.fontSize,
        fontWeight: theme.typography.h2.fontWeight,
        marginTop: theme.spacing(2),
        marginBottom: theme.spacing(1),
      },

      '& h3': {
        fontSize: theme.typography.h3.fontSize,
        fontWeight: theme.typography.h3.fontWeight,
        marginTop: theme.spacing(1.5),
        marginBottom: theme.spacing(0.5),
      },

      '& p': {
        marginBottom: theme.spacing(0.5),
      },

      '& code': {
        backgroundColor: theme.colors.background.secondary,
        padding: '2px 6px',
        borderRadius: '3px',
        fontFamily: theme.typography.fontFamilyMonospace,
        fontSize: '0.9em',
      },

      '& pre': {
        backgroundColor: theme.colors.background.secondary,
        padding: theme.spacing(1.5),
        borderRadius: theme.shape.radius.default,
        overflow: 'auto',
        fontFamily: theme.typography.fontFamilyMonospace,
        fontSize: theme.typography.bodySmall.fontSize,
        lineHeight: 1.5,
        margin: 0,
        whiteSpace: 'pre-wrap',
        wordWrap: 'break-word',

        '& code': {
          backgroundColor: 'transparent',
          padding: 0,
          fontFamily: 'inherit',
          fontSize: 'inherit',
          lineHeight: 'inherit',
          color: theme.colors.text.primary,
          display: 'block',
          whiteSpace: 'pre',
        },

        // Override any language-specific styles from Prism or other highlighters
        '& code[class*="language-"]': {
          backgroundColor: 'transparent',
          padding: 0,
          fontFamily: 'inherit',
          fontSize: 'inherit',
          lineHeight: 'inherit',
          color: theme.colors.text.primary,
          textShadow: 'none',
        },
      },

      '& ul, & ol': {
        paddingLeft: theme.spacing(3),
        marginBottom: theme.spacing(1),
      },

      '& li': {
        marginBottom: theme.spacing(0.25),

        '& p': {
          marginBottom: 0,
        },
      },

      '& blockquote': {
        borderLeft: `3px solid ${theme.colors.border.medium}`,
        paddingLeft: theme.spacing(2),
        margin: `${theme.spacing(1)} 0`,
        color: theme.colors.text.secondary,
      },

      '& a': {
        color: theme.colors.text.link,
        textDecoration: 'underline',
      },

      '& hr': {
        border: 'none',
        borderTop: `1px solid ${theme.colors.border.medium}`,
        margin: `${theme.spacing(2)} 0`,
      },

      // Placeholder styling
      '& p.is-editor-empty:first-child::before': {
        content: 'attr(data-placeholder)',
        float: 'left',
        color: theme.colors.text.disabled,
        pointerEvents: 'none',
        height: 0,
      },
    },
  }),
});

// ============================================================================
// Main Component
// ============================================================================

/**
 * Markdown block form component with rich text editing
 */
export function MarkdownBlockForm({ initialData, onSubmit, onCancel, isEditing = false }: BlockFormProps) {
  const styles = useStyles2(getBlockFormStyles);
  const editorStyles = useStyles2(getEditorStyles);

  // Initialize from existing data or defaults
  const initial = initialData && isMarkdownBlock(initialData) ? initialData : null;
  const initialHtml = useMemo(() => markdownToHtml(initial?.content ?? ''), [initial?.content]);

  // Track if content has been modified for validation
  const [hasContent, setHasContent] = useState(Boolean(initial?.content?.trim()));

  // AI customization state
  const [assistantEnabled, setAssistantEnabled] = useState(initial?.assistantEnabled ?? false);
  const [assistantId, setAssistantId] = useState(initial?.assistantId ?? '');
  const [assistantType, setAssistantType] = useState<'query' | 'config' | 'code' | 'text'>(
    initial?.assistantType ?? 'text'
  );

  // Force toolbar re-render on selection/transaction changes
  const [toolbarKey, setToolbarKey] = useState(0);

  // Rich/Raw mode toggle
  const [editMode, setEditMode] = useState<'rich' | 'raw'>('rich');
  const [rawContent, setRawContent] = useState(initial?.content ?? '');

  // Initialize TipTap editor
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Use defaults for everything
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          target: '_blank',
          rel: 'noopener noreferrer',
        },
      }),
    ],
    content: initialHtml,
    onUpdate: ({ editor: ed }) => {
      // Check if there's actual content
      const text = ed.getText();
      setHasContent(text.trim().length > 0);
      // Force toolbar update
      setToolbarKey((k) => k + 1);
    },
    onSelectionUpdate: () => {
      // Force toolbar update when selection changes
      setToolbarKey((k) => k + 1);
    },
    onTransaction: () => {
      // Force toolbar update on any transaction (covers all state changes)
      setToolbarKey((k) => k + 1);
    },
    editorProps: {
      attributes: {
        'data-placeholder': 'Start writing your content here...',
      },
    },
  });

  // Switch to raw mode - sync content from editor
  const handleSwitchToRaw = useCallback(() => {
    if (editor) {
      const html = editor.getHTML();
      const markdown = htmlToMarkdown(html);
      setRawContent(markdown);
    }
    setEditMode('raw');
  }, [editor]);

  // Switch to rich mode - sync content to editor
  const handleSwitchToRich = useCallback(() => {
    if (editor && rawContent) {
      const html = markdownToHtml(rawContent);
      editor.commands.setContent(html);
    }
    setEditMode('rich');
  }, [editor, rawContent]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      let markdown: string;
      if (editMode === 'raw') {
        markdown = rawContent.trim();
      } else if (editor) {
        const html = editor.getHTML();
        markdown = htmlToMarkdown(html);
      } else {
        return;
      }

      const block: JsonMarkdownBlock = {
        type: 'markdown',
        content: markdown,
        // AI customization props
        ...(assistantEnabled && { assistantEnabled }),
        ...(assistantEnabled && assistantId.trim() && { assistantId: assistantId.trim() }),
        ...(assistantEnabled && { assistantType }),
      };
      onSubmit(block);
    },
    [editor, editMode, rawContent, assistantEnabled, assistantId, assistantType, onSubmit]
  );

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <Field label="Content" required>
        <div className={editorStyles.container}>
          {/* Mode tabs */}
          <div className={editorStyles.modeTabs}>
            <button
              type="button"
              className={`${editorStyles.modeTab} ${editMode === 'rich' ? editorStyles.modeTabActive : ''}`}
              onClick={handleSwitchToRich}
            >
              <span>✨</span> Rich
            </button>
            <button
              type="button"
              className={`${editorStyles.modeTab} ${editMode === 'raw' ? editorStyles.modeTabActive : ''}`}
              onClick={handleSwitchToRaw}
            >
              <span>📝</span> Raw Markdown
            </button>
          </div>

          {/* Show toolbar only in rich mode */}
          {editMode === 'rich' && <EditorToolbar editor={editor} updateKey={toolbarKey} />}

          {/* Editor content - switch between rich and raw */}
          {editMode === 'rich' ? (
            <div className={editorStyles.editorContent}>
              <EditorContent editor={editor} />
            </div>
          ) : (
            <textarea
              className={editorStyles.rawTextarea}
              value={rawContent}
              onChange={(e) => {
                setRawContent(e.target.value);
                setHasContent(e.target.value.trim().length > 0);
              }}
              placeholder={`# Heading

Write your **markdown** content here.

- Bullet point
- Another point

\`\`\`
code block
\`\`\``}
            />
          )}
        </div>
      </Field>

      {/* AI Customization Section */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>AI Customization</div>
        <Field
          label="Enable AI customization"
          description="Allow users to customize this content using Grafana Assistant"
        >
          <Switch value={assistantEnabled} onChange={(e) => setAssistantEnabled(e.currentTarget.checked)} />
        </Field>

        {assistantEnabled && (
          <>
            <Field
              label="Assistant ID"
              description="Unique identifier for storing customizations (auto-generated if empty)"
            >
              <Input
                value={assistantId}
                onChange={(e) => setAssistantId(e.currentTarget.value)}
                placeholder="e.g., my-custom-content"
              />
            </Field>

            <Field label="Content type" description="Type of content being customized (affects AI prompts)">
              <Select
                options={ASSISTANT_TYPE_OPTIONS}
                value={ASSISTANT_TYPE_OPTIONS.find((o) => o.value === assistantType)}
                onChange={(option) => option.value && setAssistantType(option.value)}
              />
            </Field>
          </>
        )}
      </div>

      <div className={styles.footer}>
        <Button variant="secondary" onClick={onCancel} type="button">
          Cancel
        </Button>
        <Button variant="primary" type="submit" disabled={!hasContent}>
          {isEditing ? 'Update Block' : 'Add Block'}
        </Button>
      </div>
    </form>
  );
}

// Add display name for debugging
MarkdownBlockForm.displayName = 'MarkdownBlockForm';
