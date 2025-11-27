import React from 'react';
import { Button, IconButton, useStyles2, Menu, Dropdown } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import { Editor } from '@tiptap/react';

interface ToolbarProps {
  editor: Editor | null;
  onAddInteractive: () => void;
  onAddSequence: () => void;
  onAddComment: () => void;
  onCopy: () => Promise<void>;
  onDownload: () => Promise<void>;
  onTest: () => void;
  onReset: () => void;
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
    alignItems: 'center',
  }),
  buttonGroup: css({
    display: 'flex',
    gap: theme.spacing(0.5),
    alignItems: 'center',
  }),
  divider: css({
    width: '1px',
    height: '24px',
    background: theme.colors.border.weak,
    alignSelf: 'center',
  }),
  dropdownWrapper: css({
    position: 'relative',
  }),
  resetButtonWrapper: css({
    marginLeft: 'auto',
    display: 'flex',
  }),
  // Text formatting buttons need consistent sizing
  formatButton: css({
    minWidth: '32px',
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  }),
  formatButtonActive: css({
    backgroundColor: theme.colors.primary.main,
    color: theme.colors.primary.contrastText,
    '&:hover': {
      backgroundColor: theme.colors.primary.shade,
    },
  }),
});

/**
 * Toolbar Component
 *
 * Provides formatting and interactive element controls for the WYSIWYG editor.
 * Uses Grafana UI buttons and follows Grafana design patterns.
 * Organized to match Google Docs conventions for familiarity.
 */
export const Toolbar: React.FC<ToolbarProps> = ({
  editor,
  onAddInteractive,
  onAddSequence,
  onAddComment,
  onCopy,
  onDownload,
  onTest,
  onReset,
}) => {
  const styles = useStyles2(getStyles);

  if (!editor) {
    return null;
  }

  // Helper function to get current active style
  const getCurrentStyle = (): string => {
    if (editor.isActive('heading', { level: 1 })) {
      return 'Heading 1';
    }
    if (editor.isActive('heading', { level: 2 })) {
      return 'Heading 2';
    }
    if (editor.isActive('heading', { level: 3 })) {
      return 'Heading 3';
    }
    return 'Normal text';
  };

  const currentStyle = getCurrentStyle();

  // Build menu for text style dropdown using Grafana Menu
  const renderStyleMenu = () => (
    <Menu>
      <Menu.Item
        label="Normal text"
        icon={currentStyle === 'Normal text' ? 'check' : undefined}
        onClick={() => editor.chain().focus().setParagraph().run()}
      />
      <Menu.Item
        label="Heading 1"
        icon={currentStyle === 'Heading 1' ? 'check' : undefined}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      />
      <Menu.Item
        label="Heading 2"
        icon={currentStyle === 'Heading 2' ? 'check' : undefined}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      />
      <Menu.Item
        label="Heading 3"
        icon={currentStyle === 'Heading 3' ? 'check' : undefined}
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
          tooltip="Undo (Ctrl+Z)"
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          size="md"
          aria-label="Undo"
        />
        <IconButton
          name="repeat"
          tooltip="Redo (Ctrl+Y)"
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          size="md"
          aria-label="Redo"
        />
      </div>

      <div className={styles.divider} />

      {/* Heading Style Dropdown - using Grafana Dropdown with Menu */}
      <Dropdown overlay={renderStyleMenu} placement="bottom-start">
        <Button variant="secondary" size="sm" icon="angle-down">
          {currentStyle}
        </Button>
      </Dropdown>

      <div className={styles.divider} />

      {/* Text Formatting */}
      <div className={styles.buttonGroup}>
        <IconButton
          name="font"
          tooltip="Bold (Ctrl+B)"
          onClick={() => editor.chain().focus().toggleBold().run()}
          variant={editor.isActive('bold') ? 'primary' : 'secondary'}
          size="md"
          aria-label="Bold"
        />
        <IconButton
          name="brackets-curly"
          tooltip="Code (Ctrl+`)"
          onClick={() => editor.chain().focus().toggleCode().run()}
          variant={editor.isActive('code') ? 'primary' : 'secondary'}
          size="md"
          aria-label="Code"
        />
      </div>

      <div className={styles.divider} />

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
          tooltip="Ordered List"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          variant={editor.isActive('orderedList') ? 'primary' : 'secondary'}
          size="md"
          aria-label="Ordered List"
        />
      </div>

      <div className={styles.divider} />

      {/* Interactive Elements */}
      <div className={styles.buttonGroup}>
        <Button icon="bolt" variant="secondary" size="sm" onClick={onAddInteractive} tooltip="Add Interactive Action">
          Action
        </Button>
        <Button icon="layers-alt" variant="secondary" size="sm" onClick={onAddSequence} tooltip="Add Sequence Section">
          Section
        </Button>
        <Button icon="comment-alt" variant="secondary" size="sm" onClick={onAddComment} tooltip="Add Comment">
          Comment
        </Button>
      </div>

      <div className={styles.divider} />

      {/* Action Buttons (Clear Formatting + Copy/Download/Test) */}
      <div className={styles.buttonGroup}>
        <IconButton
          name="trash-alt"
          tooltip="Clear Formatting"
          onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}
          size="md"
          aria-label="Clear Formatting"
        />
        <IconButton name="copy" tooltip="Copy HTML" onClick={onCopy} size="md" aria-label="Copy" />
        <IconButton name="download-alt" tooltip="Download" onClick={onDownload} size="md" aria-label="Download" />
        <IconButton name="play" tooltip="Test Guide" onClick={onTest} variant="primary" size="md" aria-label="Test" />
      </div>

      {/* Reset button - right-aligned with spacing */}
      <div className={styles.resetButtonWrapper}>
        <IconButton name="times" tooltip="Reset Editor" onClick={onReset} size="md" aria-label="Reset" />
      </div>
    </div>
  );
};

export default Toolbar;
