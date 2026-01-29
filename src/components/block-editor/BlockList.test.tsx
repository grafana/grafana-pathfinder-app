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
  BlockItem: ({ block }: { block: { block: { type: string } } }) => (
    <div data-testid="block-item" data-block-type={block.block.type}>
      Block: {block.block.type}
    </div>
  ),
}));

jest.mock('./NestedBlockItem', () => ({
  NestedBlockItem: ({ block }: { block: { type: string } }) => (
    <div data-testid="nested-block-item" data-block-type={block.type}>
      Nested: {block.type}
    </div>
  ),
}));

jest.mock('./BlockPalette', () => ({
  BlockPalette: () => <div data-testid="block-palette">Add Block</div>,
}));

// Now import the component (after mocks are set up)
import { BlockList, BlockListProps } from './BlockList';
import type { EditorBlock } from './types';

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
