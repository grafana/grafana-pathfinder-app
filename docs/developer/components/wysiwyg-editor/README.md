# WYSIWYG Editor

The WYSIWYG Editor (`src/components/wysiwyg-editor/`) provides a rich text editing interface for authoring interactive guides and documentation content.

## Overview

The WYSIWYG Editor is a TipTap-based editor that allows content authors to create interactive guides visually, with support for interactive elements, comments, and formatting.

## Architecture

### Core Components

- **`WysiwygEditor.tsx`** - Main editor component
- **`Toolbar.tsx`** - Editor toolbar with formatting options
- **`FormPanel.tsx`** - Form panel for interactive element configuration
- **`CommentDialog.tsx`** - Comment dialog for annotations

### Extensions

Located in `src/components/wysiwyg-editor/extensions/`:

- **`InteractiveClickHandler.ts`** - Handles clicks on interactive elements
- **`InteractiveComment.ts`** - Comment system for interactive elements
- **`InteractiveListItem.ts`** - Interactive list item support
- **`InteractiveSpan.ts`** - Interactive span elements
- **`PasteSanitizer.ts`** - Sanitizes pasted content
- **`SequenceSection.ts`** - Sequence section support

### Forms

Located in `src/components/wysiwyg-editor/forms/`:

- **`ActionSelector.tsx`** - Action type selector
- **`BaseInteractiveForm.tsx`** - Base form for interactive elements
- **`ButtonActionForm.tsx`** - Button action configuration
- **`FormFillActionForm.tsx`** - Form fill action configuration
- **`HighlightActionForm.tsx`** - Highlight action configuration
- **`HoverActionForm.tsx`** - Hover action configuration
- **`MultistepActionForm.tsx`** - Multi-step action configuration
- **`NavigateActionForm.tsx`** - Navigate action configuration
- **`SequenceActionForm.tsx`** - Sequence action configuration

### Services

Located in `src/components/wysiwyg-editor/services/`:

- **`attributeBuilder.ts`** - Builds HTML attributes for interactive elements
- **`editorOperations.ts`** - Editor operation utilities
- **`positionResolver.ts`** - Resolves element positions
- **`validation.ts`** - Validates editor content

### Hooks

Located in `src/components/wysiwyg-editor/hooks/`:

- **`useCommentDialog.ts`** - Comment dialog management
- **`useEditorActions.ts`** - Editor action handlers
- **`useEditorInitialization.ts`** - Editor initialization
- **`useEditorModals.ts`** - Modal management
- **`useEditorPersistence.ts`** - Content persistence
- **`useEditState.ts`** - Edit state management

## Features

### Interactive Element Creation

The editor allows creating interactive elements through:
- Visual selection of elements
- Form-based configuration
- Attribute editing
- Preview and testing

### Comment System

- Add comments to elements
- Annotate interactive steps
- Collaborate on content

### Content Formatting

- Rich text formatting
- Code blocks
- Lists and tables
- Images and media

## Usage

```typescript
import { WysiwygEditor } from '../components/wysiwyg-editor';

const EditorPage = () => {
  return (
    <WysiwygEditor
      content={initialContent}
      onSave={handleSave}
      onCancel={handleCancel}
    />
  );
};
```

## Integration

The WYSIWYG Editor integrates with:
- **TipTap** - Rich text editing framework
- **Interactive Engine** - For testing interactive elements
- **Content Renderer** - For preview functionality

## See Also

- `docs/developer/interactive-examples/authoring-interactive-journeys.md` - Guide authoring
- TipTap documentation: https://tiptap.dev/

