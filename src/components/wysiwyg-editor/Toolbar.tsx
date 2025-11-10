import React from 'react';
import { Button } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { Editor } from '@tiptap/react';

interface ToolbarProps {
  editor: Editor | null;
  onAddInteractive: () => void;
  onAddSequence: () => void;
  onAddComment: () => void;
}

const getStyles = (theme: GrafanaTheme2) => ({
  toolbar: css({
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(1),
    padding: theme.spacing(1.5),
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    background: theme.colors.background.secondary,
  }),
  buttonGroup: css({
    display: 'flex',
    gap: theme.spacing(0.5),
  }),
  divider: css({
    width: '1px',
    background: theme.colors.border.weak,
    margin: `0 ${theme.spacing(1)}`,
  }),
});

/**
 * Toolbar Component
 * 
 * Provides formatting and interactive element controls for the WYSIWYG editor.
 * Uses Grafana UI buttons and follows Grafana design patterns.
 */
export const Toolbar: React.FC<ToolbarProps> = ({
  editor,
  onAddInteractive,
  onAddSequence,
  onAddComment,
}) => {
  const styles = useStyles2(getStyles);

  if (!editor) {
    return null;
  }

  return (
    <div className={styles.toolbar}>
      {/* Undo/Redo */}
      <div className={styles.buttonGroup}>
        <Button
          variant="secondary"
          size="sm"
          tooltip="Undo"
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
        >
          ↶
        </Button>
        <Button
          variant="secondary"
          size="sm"
          tooltip="Redo"
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
        >
          ↷
        </Button>
      </div>

      <div className={styles.divider} />

      {/* Text Formatting */}
      <div className={styles.buttonGroup}>
        <Button
          variant={editor.isActive('bold') ? 'primary' : 'secondary'}
          size="sm"
          tooltip="Bold"
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <strong>B</strong>
        </Button>
        <Button
          variant={editor.isActive('italic') ? 'primary' : 'secondary'}
          size="sm"
          tooltip="Italic"
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <em>I</em>
        </Button>
        <Button
          variant={editor.isActive('code') ? 'primary' : 'secondary'}
          size="sm"
          tooltip="Code"
          onClick={() => editor.chain().focus().toggleCode().run()}
        >
          {'<>'}
        </Button>
      </div>

      <div className={styles.divider} />

      {/* Headings */}
      <div className={styles.buttonGroup}>
        <Button
          variant={editor.isActive('heading', { level: 1 }) ? 'primary' : 'secondary'}
          size="sm"
          tooltip="Heading 1"
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        >
          H1
        </Button>
        <Button
          variant={editor.isActive('heading', { level: 2 }) ? 'primary' : 'secondary'}
          size="sm"
          tooltip="Heading 2"
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          H2
        </Button>
        <Button
          variant={editor.isActive('heading', { level: 3 }) ? 'primary' : 'secondary'}
          size="sm"
          tooltip="Heading 3"
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        >
          H3
        </Button>
        <Button
          variant={editor.isActive('paragraph') ? 'primary' : 'secondary'}
          size="sm"
          tooltip="Paragraph"
          onClick={() => editor.chain().focus().setParagraph().run()}
        >
          P
        </Button>
      </div>

      <div className={styles.divider} />

      {/* Lists */}
      <div className={styles.buttonGroup}>
        <Button
          icon="list-ul"
          variant={editor.isActive('bulletList') ? 'primary' : 'secondary'}
          size="sm"
          tooltip="Bullet List"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        />
        <Button
          icon="list-ol"
          variant={editor.isActive('orderedList') ? 'primary' : 'secondary'}
          size="sm"
          tooltip="Ordered List"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        />
      </div>

      <div className={styles.divider} />

      {/* Interactive Elements */}
      <div className={styles.buttonGroup}>
        <Button
          icon="bolt"
          variant="secondary"
          size="sm"
          onClick={onAddInteractive}
          tooltip="Add Interactive Action"
        >
          Action
        </Button>
        <Button
          icon="layers-alt"
          variant="secondary"
          size="sm"
          onClick={onAddSequence}
          tooltip="Add Sequence Section"
        >
          Section
        </Button>
        <Button
          icon="comment-alt"
          variant="secondary"
          size="sm"
          onClick={onAddComment}
          tooltip="Add Comment"
        >
          Add Comment
        </Button>
      </div>

      <div className={styles.divider} />

      {/* Clear Formatting */}
      <Button
        icon="trash-alt"
        variant="secondary"
        size="sm"
        tooltip="Clear Formatting"
        onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}
      />
    </div>
  );
};

export default Toolbar;

