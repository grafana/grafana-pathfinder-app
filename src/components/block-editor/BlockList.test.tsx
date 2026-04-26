/**
 * BlockList Smoke Tests
 *
 * Basic tests for the @dnd-kit based drag-and-drop functionality.
 * These tests verify core rendering and document behavior constraints.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';

// Mock all child components that have complex styling/dependencies
jest.mock('./BlockItem', () => ({
  BlockItem: ({
    block,
    onPreview,
    isPreviewActive,
  }: {
    block: { block: { type: string } };
    onPreview?: () => void;
    isPreviewActive?: boolean;
  }) => (
    <div
      data-testid="block-item"
      data-block-type={block.block.type}
      data-preview-active={isPreviewActive ? 'true' : 'false'}
      onClick={() => onPreview?.()}
    >
      Block: {block.block.type}
    </div>
  ),
}));

jest.mock('./NestedBlockItem', () => ({
  NestedBlockItem: ({
    block,
    onPreview,
    isPreviewActive,
  }: {
    block: { type: string };
    onPreview?: () => void;
    isPreviewActive?: boolean;
  }) => (
    <div
      data-testid="nested-block-item"
      data-block-type={block.type}
      data-preview-active={isPreviewActive ? 'true' : 'false'}
      onClick={() => onPreview?.()}
    >
      Nested: {block.type}
    </div>
  ),
}));

jest.mock('./BlockPalette', () => ({
  BlockPalette: () => <div data-testid="block-palette">Add Block</div>,
}));

jest.mock('./BlockPreview', () => ({
  BlockPreview: ({ guide }: { guide: { id: string } }) => <div data-testid={`inline-preview-${guide.id}`}>Preview</div>,
}));

// Now import the component (after mocks are set up)
import { BlockList, BlockListProps } from './BlockList';
import type { EditorBlock, JsonGuide, PreviewTarget } from './types';

// Create test blocks
const createMarkdownBlock = (id: string, content: string): EditorBlock => ({
  id,
  block: { type: 'markdown', content },
});

const createSectionBlock = (
  id: string,
  title: string,
  nestedBlocks: Array<EditorBlock['block']> = []
): EditorBlock => ({
  id,
  block: {
    type: 'section',
    id,
    title,
    blocks: nestedBlocks,
  },
});

const createConditionalBlock = (
  id: string,
  conditions: string[],
  whenTrue: Array<EditorBlock['block']> = [],
  whenFalse: Array<EditorBlock['block']> = []
): EditorBlock => ({
  id,
  block: {
    type: 'conditional',
    conditions,
    whenTrue,
    whenFalse,
  },
});

const defaultOperations = {
  onBlockEdit: jest.fn(),
  onBlockDelete: jest.fn(),
  onBlockMove: jest.fn(),
  onBlockDuplicate: jest.fn(),
  onInsertBlock: jest.fn(),
  onNestBlock: jest.fn(),
  onUnnestBlock: jest.fn(),
  onInsertBlockInSection: jest.fn(),
  onNestedBlockEdit: jest.fn(),
  onNestedBlockDelete: jest.fn(),
  onNestedBlockDuplicate: jest.fn(),
  onNestedBlockMove: jest.fn(),
  onSectionRecord: jest.fn(),
  recordingIntoSection: null,
  onConditionalBranchRecord: jest.fn(),
  recordingIntoConditionalBranch: null,
  isSelectionMode: false,
  selectedBlockIds: new Set<string>(),
  onToggleBlockSelection: jest.fn(),
  onInsertBlockInConditional: jest.fn(),
  onConditionalBranchBlockEdit: jest.fn(),
  onConditionalBranchBlockDelete: jest.fn(),
  onConditionalBranchBlockDuplicate: jest.fn(),
  onConditionalBranchBlockMove: jest.fn(),
  onNestBlockInConditional: jest.fn(),
  onUnnestBlockFromConditional: jest.fn(),
  onMoveBlockBetweenConditionalBranches: jest.fn(),
  onMoveBlockBetweenSections: jest.fn(),
};

const defaultProps: Omit<BlockListProps, 'blocks'> = {
  operations: defaultOperations,
};

const previewGuide: JsonGuide = {
  id: 'preview-guide',
  title: 'Preview',
  blocks: [{ type: 'markdown', content: 'Preview content' }],
};

describe('BlockList', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders a list of blocks', () => {
      const blocks: EditorBlock[] = [
        createMarkdownBlock('1', 'First block'),
        createMarkdownBlock('2', 'Second block'),
        createMarkdownBlock('3', 'Third block'),
      ];

      render(<BlockList blocks={blocks} {...defaultProps} />);

      // Check that all blocks are rendered
      const blockItems = screen.getAllByTestId('block-item');
      expect(blockItems).toHaveLength(3);
    });

    it('renders section blocks', () => {
      const blocks: EditorBlock[] = [
        createSectionBlock('section-1', 'My Section', [{ type: 'markdown', content: 'Nested content' }]),
      ];

      render(<BlockList blocks={blocks} {...defaultProps} />);

      // Section block should be rendered
      const sectionBlock = screen.getByTestId('block-item');
      expect(sectionBlock).toHaveAttribute('data-block-type', 'section');

      // Nested block should be rendered
      const nestedBlock = screen.getByTestId('nested-block-item');
      expect(nestedBlock).toHaveAttribute('data-block-type', 'markdown');
    });

    it('renders conditional blocks with both branches', () => {
      const blocks: EditorBlock[] = [
        createConditionalBlock(
          'cond-1',
          ['datasource-configured:prometheus'],
          [{ type: 'markdown', content: 'Show when true' }],
          [{ type: 'markdown', content: 'Show when false' }]
        ),
      ];

      render(<BlockList blocks={blocks} {...defaultProps} />);

      // Conditional block should be rendered
      const conditionalBlock = screen.getByTestId('block-item');
      expect(conditionalBlock).toHaveAttribute('data-block-type', 'conditional');

      // Both branch nested blocks should be rendered
      const nestedBlocks = screen.getAllByTestId('nested-block-item');
      expect(nestedBlocks).toHaveLength(2);
    });

    it('renders block palette for inserting new blocks', () => {
      const blocks: EditorBlock[] = [createMarkdownBlock('1', 'Block')];

      render(<BlockList blocks={blocks} {...defaultProps} />);

      // Block palette should be present for adding new blocks
      const palettes = screen.getAllByTestId('block-palette');
      expect(palettes.length).toBeGreaterThan(0);
    });

    it('wires onBlockPreview for root blocks', () => {
      const blocks: EditorBlock[] = [createMarkdownBlock('1', 'Preview me')];
      const onBlockPreview = jest.fn();

      render(
        <BlockList
          blocks={blocks}
          operations={{
            ...defaultOperations,
            onBlockPreview,
          }}
        />
      );

      const blockItem = screen.getByTestId('block-item');
      blockItem.click();
      expect(onBlockPreview).toHaveBeenCalledWith(blocks[0]);
    });

    it('toggles root preview off when active block is clicked again', () => {
      const blocks: EditorBlock[] = [createMarkdownBlock('block-1', 'Preview me')];
      const onClearPreview = jest.fn();

      render(
        <BlockList
          blocks={blocks}
          operations={{
            ...defaultOperations,
            onBlockPreview: jest.fn(),
          }}
          previewGuide={previewGuide}
          previewTarget={{ type: 'root', blockId: 'block-1' }}
          onClearPreview={onClearPreview}
          previewClasses={{ container: 'preview-container', actions: 'preview-actions' }}
        />
      );

      screen.getByTestId('block-item').click();
      expect(onClearPreview).toHaveBeenCalledTimes(1);
    });

    it('renders inline preview directly below the targeted root block', () => {
      const blocks: EditorBlock[] = [
        createMarkdownBlock('block-1', 'First block'),
        createMarkdownBlock('block-2', 'Second block'),
      ];
      const previewTarget: PreviewTarget = { type: 'root', blockId: 'block-1' };

      render(
        <BlockList
          blocks={blocks}
          operations={defaultOperations}
          previewGuide={previewGuide}
          previewTarget={previewTarget}
          previewClasses={{ container: 'preview-container', actions: 'preview-actions' }}
        />
      );

      const blockItems = screen.getAllByTestId('block-item');
      expect(blockItems).toHaveLength(2);
      const preview = screen.getByTestId('inline-preview-preview-guide');

      const firstBlockPos = blockItems[0]!.compareDocumentPosition(preview);
      const secondBlockPos = blockItems[1]!.compareDocumentPosition(preview);
      expect(firstBlockPos & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(secondBlockPos & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    });

    it('wires nested preview clicks to section child target', () => {
      const blocks: EditorBlock[] = [
        createSectionBlock('section-1', 'My Section', [{ type: 'multistep', content: '', steps: [] }]),
      ];
      const onNestedSectionBlockPreview = jest.fn();

      render(
        <BlockList
          blocks={blocks}
          operations={{
            ...defaultOperations,
            onNestedSectionBlockPreview,
          }}
        />
      );

      screen.getByTestId('nested-block-item').click();
      expect(onNestedSectionBlockPreview).toHaveBeenCalledWith('section-1', 0);
    });
  });

  describe('empty sections', () => {
    it('shows message for empty sections', () => {
      const blocks: EditorBlock[] = [createSectionBlock('section-1', 'Empty Section', [])];

      render(<BlockList blocks={blocks} {...defaultProps} />);

      // Empty section message
      expect(screen.getByText(/Drag blocks here or click/)).toBeInTheDocument();
    });

    it('shows message for empty conditional branches', () => {
      const blocks: EditorBlock[] = [createConditionalBlock('cond-1', ['test-condition'], [], [])];

      render(<BlockList blocks={blocks} {...defaultProps} />);

      // Both empty branch messages
      const emptyMessages = screen.getAllByText(/Drag blocks here or click/);
      expect(emptyMessages.length).toBe(2);
    });
  });
});
