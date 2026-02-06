# Block Editor

The Block Editor provides a visual interface for authoring interactive JSON guides without writing code directly. It supports drag-and-drop block composition, recording user actions, and exporting guides to GitHub PRs.

## Overview

The Block Editor is a sophisticated guide authoring tool that enables content creators to build interactive learning experiences through a block-based interface. It replaces the previous WYSIWYG editor with a more structured approach optimized for JSON guide creation.

## Location

**Path**: `/src/components/block-editor/`
**Entry Point**: `BlockEditor.tsx`

## Purpose

The Block Editor exists to:

- Enable non-developers to create interactive guides visually
- Standardize guide structure through block-based composition
- Record user interactions and convert them to guide steps
- Test guides in real-time during authoring
- Export guides to GitHub for version control and review
- Reduce errors in manual JSON editing

## Key Features

### Visual Block Composition

- **Block Palette**: Library of available block types
- **Drag and Drop**: Reorder blocks and sections visually
- **Nested Blocks**: Support for sections and conditional branches
- **Block Forms**: Type-specific forms for configuring block properties
- **Preview Mode**: Test guides before exporting

### Recording Mode

- **Action Recording**: Capture user interactions in Grafana UI
- **Automatic Step Generation**: Convert actions to interactive steps
- **Multi-step Grouping**: Group related actions into sequences
- **Modal Detection**: Automatically detect and handle modals
- **Selector Extraction**: Generate reliable CSS selectors

### Import/Export

- **JSON Import**: Load existing guides for editing
- **JSON Export**: Export guides to clipboard or file
- **GitHub PR Integration**: Create PRs directly from editor
- **Guide Metadata**: Title, description, and URL configuration

### State Persistence

- **Auto-save**: State persists to localStorage automatically
- **Crash Recovery**: Recover work after browser refresh
- **Multi-guide Support**: Work on multiple guides independently

## Architecture

### Core Components

**BlockEditor.tsx** - Main editor component

- Orchestrates all editor functionality
- Manages editor state and lifecycle
- Coordinates recording and editing modes

**BlockList.tsx** - Block list display and management

- Renders list of blocks
- Handles drag-and-drop reordering
- Manages block selection and deletion

**BlockPalette.tsx** - Block type picker

- Displays available block types
- Handles block insertion
- Categorizes blocks by type

**BlockFormModal.tsx** - Block configuration forms

- Dynamic form based on block type
- Validation and error handling
- Nested block support

**RecordModeOverlay.tsx** - Recording mode UI

- Overlay during action recording
- Stop recording button
- Recording status display

### Forms Directory

Contains type-specific forms for each block type:

- `TextBlockForm.tsx` - Text content blocks
- `InteractiveBlockForm.tsx` - Interactive step blocks
- `MultistepBlockForm.tsx` - Multi-step sequences
- `GuidedBlockForm.tsx` - Guided highlight blocks
- `SectionBlockForm.tsx` - Section containers
- `ConditionalBlockForm.tsx` - Conditional branches
- Additional forms for other block types

### Hooks Directory

Custom hooks for separating concerns:

- `useBlockEditor.ts` - Core editor state management
- `useBlockPersistence.ts` - localStorage persistence
- `useRecordingPersistence.ts` - Recording state persistence
- `useModalManager.ts` - Modal state management
- `useBlockSelection.ts` - Block selection mode
- `useBlockFormState.ts` - Form modal state
- `useRecordingState.ts` - Recording mode state
- `useRecordingActions.ts` - Recording action handlers
- `useJsonModeHandlers.ts` - JSON import/export
- `useBlockConversionHandlers.ts` - Block type conversion
- `useGuideOperations.ts` - Guide-level operations

### Services Directory

Utility services for editor operations:

- `attributeBuilder.ts` - HTML attribute generation
- `editorOperations.ts` - Block manipulation utilities
- `positionResolver.ts` - DOM position resolution
- `validation.ts` - Guide and block validation

### Utils Directory

Helper utilities:

- `block-utils.ts` - Block manipulation helpers
- `guide-utils.ts` - Guide-level utilities
- `selector-utils.ts` - CSS selector generation
- `json-utils.ts` - JSON import/export utilities

## Block Types

The editor supports these block types:

- **Text**: Markdown content blocks
- **Interactive**: Single interactive steps with requirements and objectives
- **Multistep**: Grouped sequences of interactive steps
- **Guided**: Highlight elements with tooltips
- **Section**: Container for organizing blocks
- **Conditional**: Branching logic based on conditions
- **Image**: Image display blocks
- **Video**: Video embed blocks
- **Code**: Code snippet blocks
- **Alert**: Callout/alert blocks

## Usage Flow

### Creating a New Guide

1. Open dev tools panel (dev mode required)
2. Expand "Interactive guide editor" section
3. Click "New Guide" (or start with empty editor)
4. Add blocks from palette or use recording mode
5. Configure each block via form modals
6. Test guide in preview mode
7. Export to JSON or create GitHub PR

### Recording User Actions

1. Click "Record Section" or "Record Into Section"
2. Perform actions in Grafana UI
3. Actions are captured and converted to steps
4. Click "Stop Recording" when done
5. Review and edit generated steps
6. Adjust selectors and objectives as needed

### Editing Existing Guides

1. Click "Import" button
2. Paste JSON guide content
3. Edit blocks visually
4. Export updated guide

## Dependencies

### Core Dependencies

- **React**: UI framework
- **@grafana/ui**: Grafana UI components
- **@grafana/data**: Data types and utilities
- **@dnd-kit**: Drag-and-drop functionality

### Internal Dependencies

- **Interactive Engine**: Testing interactive steps
- **Action Recorder**: Recording user interactions
- **Content Renderer**: Previewing guides
- **GitHub API**: Creating pull requests

## Integration Points

### SelectorDebugPanel

The Block Editor is loaded lazily within the SelectorDebugPanel component when dev mode is enabled. This keeps it out of production bundles.

### DevTools Integration

Accessed via:

1. Enable dev mode in plugin configuration
2. Open Pathfinder sidebar
3. Stay on "Recommendations" tab
4. Scroll to "DOM Selector Debug" section
5. Expand "Interactive guide editor"

### GitHub Integration

- Creates PRs against content repositories
- Validates guide structure before export
- Includes metadata in PR description

### Content System

- Guides authored here are consumed by the content rendering system
- Interactive engine executes steps defined in guides
- Requirements manager validates step completion

## Configuration

The editor can be configured via:

- **localStorage keys**: Persistence of editor state
- **Recording options**: Multi-step grouping, modal detection
- **Exclude selectors**: Elements to ignore during recording

## Data Collected

The editor collects and stores:

- **Guide Content**: All blocks and their configurations
- **Recording State**: Current recording mode and target
- **Editor State**: Selected blocks, form state, modal visibility
- **User Preferences**: Recording options, ordered file lists (for PR testing)

All data is stored locally in browser localStorage and not transmitted except during GitHub PR creation.

## See Also

- `docs/developer/interactive-engine/` - Interactive step execution
- `docs/developer/GUIDE_AUTHORING.md` - Guide authoring best practices
- `docs/developer/components/SelectorDebugPanel/` - Dev tools container
