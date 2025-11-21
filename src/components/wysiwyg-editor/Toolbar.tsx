import React, { useState, useEffect, useRef } from 'react';
import { Button, useStyles2 } from '@grafana/ui';
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
  }),
  buttonGroup: css({
    display: 'flex',
    gap: theme.spacing(0.5),
  }),
  divider: css({
    width: '1px',
    background: theme.colors.border.weak,
  }),
  dropdownWrapper: css({
    position: 'relative',
  }),
  dropdownMenu: css({
    position: 'absolute',
    top: '100%',
    left: 0,
    marginTop: theme.spacing(0.5),
    minWidth: '160px',
    background: theme.colors.background.primary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    boxShadow: theme.shadows.z3,
    zIndex: 1000,
    padding: theme.spacing(0.5),
  }),
  dropdownMenuItem: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    padding: `${theme.spacing(0.75)} ${theme.spacing(1)}`,
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    borderRadius: theme.shape.radius.default,
    fontSize: theme.typography.body.fontSize,
    color: theme.colors.text.primary,
    '&:hover': {
      background: theme.colors.action.hover,
    },
  }),
  dropdownMenuItemActive: css({
    fontWeight: theme.typography.fontWeightMedium,
  }),
  dropdownCheckmark: css({
    marginLeft: theme.spacing(1),
    color: theme.colors.primary.text,
  }),
  resetButtonWrapper: css({
    marginLeft: 'auto',
    display: 'flex',
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
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const dropdownWrapperRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownWrapperRef.current && !dropdownWrapperRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };

    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }

    return undefined;
  }, [isDropdownOpen]);

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
    return 'Normal text'; // paragraph is default
  };

  // Style options for dropdown
  const styleOptions = [
    { label: 'Normal text', action: () => editor.chain().focus().setParagraph().run() },
    { label: 'Heading 1', action: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
    { label: 'Heading 2', action: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: 'Heading 3', action: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
  ];

  const currentStyle = getCurrentStyle();
  const isStyleActive = (label: string): boolean => {
    return label === currentStyle;
  };

  const handleStyleSelect = (action: () => void) => {
    action();
    setIsDropdownOpen(false);
  };

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

      {/* Heading Style Dropdown */}
      <div ref={dropdownWrapperRef} className={styles.dropdownWrapper}>
        <Button
          variant="secondary"
          size="sm"
          tooltip="Text Style"
          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          icon={isDropdownOpen ? 'angle-up' : 'angle-down'}
        >
          {currentStyle}
        </Button>
        {isDropdownOpen && (
          <div ref={dropdownRef} className={styles.dropdownMenu}>
            {styleOptions.map((option) => (
              <button
                key={option.label}
                className={`${styles.dropdownMenuItem} ${isStyleActive(option.label) ? styles.dropdownMenuItemActive : ''}`}
                onClick={() => handleStyleSelect(option.action)}
              >
                <span>{option.label}</span>
                {isStyleActive(option.label) && <span className={styles.dropdownCheckmark}>✓</span>}
              </button>
            ))}
          </div>
        )}
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
          variant={editor.isActive('code') ? 'primary' : 'secondary'}
          size="sm"
          tooltip="Code"
          onClick={() => editor.chain().focus().toggleCode().run()}
        >
          {'<>'}
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
        <Button
          icon="trash-alt"
          variant="secondary"
          size="sm"
          tooltip="Clear Formatting"
          onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}
        />
        <Button icon="copy" variant="secondary" size="sm" onClick={onCopy} tooltip="Copy"></Button>
        <Button icon="download-alt" variant="secondary" size="sm" onClick={onDownload} tooltip="Download"></Button>
        <Button icon="play" variant="primary" size="sm" onClick={onTest} tooltip="Test"></Button>
      </div>

      {/* Reset button - right-aligned with spacing */}
      <div className={styles.resetButtonWrapper}>
        <Button icon="arrow-from-right" variant="secondary" size="sm" onClick={onReset} tooltip="Reset"></Button>
      </div>
    </div>
  );
};

export default Toolbar;
