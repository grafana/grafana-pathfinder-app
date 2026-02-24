/**
 * Markdown Block Form
 *
 * Rich WYSIWYG Markdown editor using TipTap.
 * Stores content as Markdown while providing rich editing experience.
 */

import React, { useState, useCallback } from 'react';
import {
  Button,
  Field,
  IconButton,
  useStyles2,
  Menu,
  Dropdown,
  Switch,
  Combobox,
  Input,
  type ComboboxOption,
} from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import { useEditor, EditorContent, Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { Markdown } from '@tiptap/markdown';
import { getBlockFormStyles } from '../block-editor.styles';
import { TypeSwitchDropdown } from './TypeSwitchDropdown';
import { testIds } from '../../../constants/testIds';
import type { BlockFormProps, JsonBlock } from '../types';
import type { JsonMarkdownBlock } from '../../../types/json-guide.types';

/** Assistant content type options */
const ASSISTANT_TYPE_OPTIONS: Array<ComboboxOption<'query' | 'config' | 'code' | 'text'>> = [
  { value: 'query', label: 'Query', description: 'PromQL, LogQL, or other query languages' },
  { value: 'config', label: 'Configuration', description: 'Configuration values or settings' },
  { value: 'code', label: 'Code', description: 'Code snippets' },
  { value: 'text', label: 'Text', description: 'General text content' },
];

/**
 * Type guard for Markdown blocks
 */
function isMarkdownBlock(block: JsonBlock): block is JsonMarkdownBlock {
  return block.type === 'markdown';
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
    minHeight: '200px',
    maxHeight: '300px',
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
    minHeight: '200px',
    maxHeight: '300px',
    overflowY: 'auto',
    padding: theme.spacing(1.5),

    // TipTap/ProseMirror styling
    '& .ProseMirror': {
      outline: 'none',
      minHeight: '170px',

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
export function MarkdownBlockForm({
  initialData,
  onSubmit,
  onCancel,
  isEditing = false,
  onSwitchBlockType,
}: BlockFormProps) {
  const styles = useStyles2(getBlockFormStyles);
  const editorStyles = useStyles2(getEditorStyles);

  // Initialize from existing data or defaults
  const initial = initialData && isMarkdownBlock(initialData) ? initialData : null;
  const initialMarkdown = initial?.content ?? '';

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
  const [rawContent, setRawContent] = useState(initialMarkdown);

  // Initialize TipTap editor with Markdown extension
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
      Markdown.configure({
        markedOptions: {
          // Use GitHub flavored Markdown which Grafana also uses.
          // https://github.com/grafana/grafana/blob/fda47eb3af61034b1e28bec932c06298d85b7743/packages/grafana-data/src/text/markdown.ts#L15
          gfm: true,
        },
      }),
    ],

    content: initialMarkdown,
    contentType: 'markdown',
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

  // Switch to raw mode - get Markdown from editor
  const handleSwitchToRaw = useCallback(() => {
    if (editor) {
      const markdown = editor.getMarkdown() || editor.getText();
      setRawContent(markdown);
    }
    setEditMode('raw');
  }, [editor]);

  // Switch to rich mode - set Markdown content in editor
  const handleSwitchToRich = useCallback(() => {
    if (editor && rawContent) {
      editor.commands.setContent(rawContent, { contentType: 'markdown' });
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
        markdown = editor.getMarkdown() || editor.getText();
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
              data-testid={testIds.blockEditor.richMarkdownTab}
            >
              <span>✨</span> Rich
            </button>
            <button
              type="button"
              className={`${editorStyles.modeTab} ${editMode === 'raw' ? editorStyles.modeTabActive : ''}`}
              onClick={handleSwitchToRaw}
              data-testid={testIds.blockEditor.rawMarkdownTab}
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
              data-testid={testIds.blockEditor.markdownTextarea}
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
              <Combobox
                options={ASSISTANT_TYPE_OPTIONS}
                value={assistantType}
                onChange={(option) => setAssistantType(option.value)}
              />
            </Field>
          </>
        )}
      </div>

      <div className={styles.footer}>
        {isEditing && onSwitchBlockType && (
          <div className={styles.footerLeft}>
            <TypeSwitchDropdown currentType="markdown" onSwitch={onSwitchBlockType} blockData={initialData} />
          </div>
        )}
        <Button variant="secondary" onClick={onCancel} type="button">
          Cancel
        </Button>
        <Button variant="primary" type="submit" disabled={!hasContent} data-testid={testIds.blockEditor.submitButton}>
          {isEditing ? 'Update block' : 'Add block'}
        </Button>
      </div>
    </form>
  );
}

// Add display name for debugging
MarkdownBlockForm.displayName = 'MarkdownBlockForm';
