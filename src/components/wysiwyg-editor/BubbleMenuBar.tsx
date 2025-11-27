import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Editor } from '@tiptap/react';
import { IconButton, useStyles2, Portal, Modal, Button, Input, Field } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';

interface BubbleMenuBarProps {
  editor: Editor | null;
}

interface MenuPosition {
  top: number;
  left: number;
}

const getStyles = (theme: GrafanaTheme2) => ({
  bubbleMenu: css({
    position: 'fixed',
    display: 'flex',
    gap: theme.spacing(0.5),
    padding: theme.spacing(0.5),
    backgroundColor: theme.colors.background.primary,
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    boxShadow: theme.shadows.z3,
    alignItems: 'center',
    zIndex: theme.zIndex.tooltip,
    // Center horizontally and position so bottom of menu is at the top coordinate
    transform: 'translateX(-50%) translateY(-100%)',
  }),
  divider: css({
    width: '1px',
    height: '20px',
    backgroundColor: theme.colors.border.weak,
    margin: `0 ${theme.spacing(0.25)}`,
  }),
  // Link dialog styles
  linkModal: css({
    width: '400px',
    maxWidth: '90vw',
  }),
  linkModalContent: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
  }),
  linkButtonGroup: css({
    display: 'flex',
    gap: theme.spacing(1),
    justifyContent: 'flex-end',
  }),
});

/**
 * LinkDialog - Internal component for adding/editing links
 */
interface LinkDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (url: string) => void;
  onRemove: () => void;
  initialUrl?: string;
  hasExistingLink: boolean;
}

const LinkDialog: React.FC<LinkDialogProps> = ({
  isOpen,
  onClose,
  onApply,
  onRemove,
  initialUrl = '',
  hasExistingLink,
}) => {
  const styles = useStyles2(getStyles);
  // Initialize with initialUrl - component is keyed by isOpen state in parent
  const [url, setUrl] = useState(initialUrl);

  const handleApply = () => {
    const trimmedUrl = url.trim();
    if (trimmedUrl) {
      // Normalize URL: add https:// if no protocol specified
      let normalizedUrl = trimmedUrl;
      if (!/^https?:\/\//i.test(trimmedUrl) && !trimmedUrl.startsWith('/')) {
        normalizedUrl = `https://${trimmedUrl}`;
      }
      onApply(normalizedUrl);
    }
    onClose();
  };

  const handleRemove = () => {
    onRemove();
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleApply();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  if (!isOpen) {
    return null;
  }

  const isValid = url.trim().length > 0;

  return (
    <Modal
      title={hasExistingLink ? 'Edit Link' : 'Add Link'}
      isOpen={isOpen}
      onDismiss={onClose}
      className={styles.linkModal}
    >
      <div className={styles.linkModalContent}>
        <Field label="URL" description="Enter a URL (https:// will be added automatically if needed)">
          <Input
            value={url}
            onChange={(e) => setUrl(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            placeholder="example.com or https://example.com"
            autoFocus
          />
        </Field>
        <div className={styles.linkButtonGroup}>
          {hasExistingLink && (
            <Button variant="destructive" onClick={handleRemove}>
              Remove Link
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleApply} disabled={!isValid}>
            {hasExistingLink ? 'Update' : 'Add'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

/**
 * BubbleMenuBar Component
 *
 * A floating toolbar that appears when text is selected in the editor.
 * Provides quick access to formatting options without leaving the content area.
 * Uses Grafana UI components for consistent styling.
 *
 * Custom implementation that positions based on selection without external dependencies.
 */
export const BubbleMenuBar: React.FC<BubbleMenuBarProps> = ({ editor }) => {
  const styles = useStyles2(getStyles);
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState<MenuPosition>({ top: 0, left: 0 });
  const [isLinkDialogOpen, setIsLinkDialogOpen] = useState(false);

  // Use ref to track dialog state for blur handler (avoids stale closure)
  const isLinkDialogOpenRef = useRef(false);

  // Sync ref with state in effect (not during render)
  useEffect(() => {
    isLinkDialogOpenRef.current = isLinkDialogOpen;
  }, [isLinkDialogOpen]);

  const updateMenuPosition = useCallback(() => {
    if (!editor) {
      return;
    }

    const { state } = editor;
    const { from, to, empty } = state.selection;

    // Don't show if no selection or selection is empty
    if (empty || from === to) {
      setIsVisible(false);
      return;
    }

    // Don't show inside code blocks
    if (editor.isActive('codeBlock')) {
      setIsVisible(false);
      return;
    }

    // Get selection coordinates using the view
    const { view } = editor;
    const start = view.coordsAtPos(from);
    const end = view.coordsAtPos(to);

    // Position menu above the selection, centered
    // translateY(-100%) moves the menu up by its own height
    // We subtract 8px to add a gap between menu and text
    const left = (start.left + end.right) / 2;
    const top = start.top - 8;

    setPosition({ top, left });
    setIsVisible(true);
  }, [editor]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    // Listen for selection changes
    const handleSelectionUpdate = () => {
      // Don't update position while link dialog is open (would reset visibility)
      if (!isLinkDialogOpenRef.current) {
        updateMenuPosition();
      }
    };

    // Listen for blur to hide menu
    const handleBlur = () => {
      // Don't hide if link dialog is open (use ref to get current value)
      if (isLinkDialogOpenRef.current) {
        return;
      }

      // Small delay to allow clicking on menu buttons
      setTimeout(() => {
        // Check again after delay in case dialog opened
        if (isLinkDialogOpenRef.current) {
          return;
        }
        const activeEl = document.activeElement;
        const menuEl = document.querySelector('[data-bubble-menu]');
        if (menuEl && menuEl.contains(activeEl)) {
          return;
        }
        setIsVisible(false);
      }, 100);
    };

    editor.on('selectionUpdate', handleSelectionUpdate);
    editor.on('blur', handleBlur);

    // REACT: cleanup event listeners (R1)
    return () => {
      editor.off('selectionUpdate', handleSelectionUpdate);
      editor.off('blur', handleBlur);
    };
  }, [editor, updateMenuPosition]);

  if (!editor) {
    return null;
  }

  const handleFormat = (action: () => void) => {
    action();
    // Keep focus on editor
    editor.commands.focus();
  };

  return (
    <>
      {/* Bubble menu - only shown when visible */}
      {isVisible && (
        <Portal>
          <div
            data-bubble-menu
            className={styles.bubbleMenu}
            style={{
              top: `${position.top}px`,
              left: `${position.left}px`,
            }}
            onMouseDown={(e) => {
              // Prevent menu click from blurring editor
              e.preventDefault();
            }}
          >
            <IconButton
              name="font"
              tooltip="Bold (Ctrl+B)"
              onClick={() => handleFormat(() => editor.chain().focus().toggleBold().run())}
              variant={editor.isActive('bold') ? 'primary' : 'secondary'}
              size="sm"
              aria-label="Bold"
            />
            <IconButton
              name="brackets-curly"
              tooltip="Code (Ctrl+`)"
              onClick={() => handleFormat(() => editor.chain().focus().toggleCode().run())}
              variant={editor.isActive('code') ? 'primary' : 'secondary'}
              size="sm"
              aria-label="Code"
            />

            <div className={styles.divider} />

            <IconButton
              name="external-link-alt"
              tooltip="Add Link"
              onClick={() => setIsLinkDialogOpen(true)}
              variant={editor.isActive('link') ? 'primary' : 'secondary'}
              size="sm"
              aria-label="Link"
            />

            <div className={styles.divider} />

            <IconButton
              name="times-circle"
              tooltip="Clear Formatting"
              onClick={() => handleFormat(() => editor.chain().focus().unsetAllMarks().run())}
              size="sm"
              aria-label="Clear Formatting"
            />
          </div>
        </Portal>
      )}

      {/* Link dialog - rendered independently of bubble menu visibility */}
      {/* Key forces re-mount when dialog opens, ensuring fresh state */}
      {isLinkDialogOpen && (
        <LinkDialog
          isOpen={isLinkDialogOpen}
          onClose={() => {
            setIsLinkDialogOpen(false);
            editor.commands.focus();
          }}
          onApply={(url) => {
            editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
          }}
          onRemove={() => {
            editor.chain().focus().extendMarkRange('link').unsetLink().run();
          }}
          initialUrl={editor.getAttributes('link').href || ''}
          hasExistingLink={editor.isActive('link')}
        />
      )}
    </>
  );
};

export default BubbleMenuBar;
