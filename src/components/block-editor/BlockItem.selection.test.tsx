import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { BlockItem } from './BlockItem';
import { NestedBlockItem } from './NestedBlockItem';
import type { BlockType, EditorBlock, JsonBlock } from './types';

const classes = new Proxy(
  {},
  {
    get: () => 'class-name',
  }
);

jest.mock('@grafana/ui', () => ({
  Badge: ({ text }: { text: React.ReactNode }) => <span>{text}</span>,
  Checkbox: ({ value, onChange }: { value?: boolean; onChange?: React.ChangeEventHandler<HTMLInputElement> }) => (
    <input type="checkbox" checked={value} onChange={onChange} />
  ),
  IconButton: ({ onClick, 'aria-label': ariaLabel, children }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button aria-label={ariaLabel} onClick={onClick}>
      {children}
    </button>
  ),
  useStyles2: () => classes,
}));
jest.mock('./AuthorNoteModal', () => ({ AuthorNoteModal: () => null }));
jest.mock('./ConfirmDeleteButton', () => ({ ConfirmDeleteButton: () => null }));
jest.mock('./LintBadge', () => ({ LintBadge: () => null }));
jest.mock('./utils', () => ({ getBlockPreview: () => '' }));
jest.mock('./block-editor.styles', () => ({ getBlockItemStyles: () => classes }));
jest.mock('./BlockList.styles', () => ({ getNestedBlockItemStyles: () => classes }));
jest.mock('./constants', () => ({ BLOCK_TYPE_METADATA: {} }));

const BLOCK_TYPES: BlockType[] = [
  'markdown',
  'divider',
  'html',
  'image',
  'video',
  'section',
  'collapsible',
  'callout',
  'conditional',
  'interactive',
  'multistep',
  'guided',
  'quiz',
  'assistant',
  'input',
  'terminal',
  'terminal-connect',
  'challenge',
  'code-block',
  'grot-guide',
  'snippet-ref',
];

function blockOfType(type: BlockType): JsonBlock {
  return type === 'conditional'
    ? ({ type, conditions: [], whenTrue: [], whenFalse: [] } as JsonBlock)
    : ({ type } as JsonBlock);
}

const rootItem = (type: BlockType): EditorBlock => ({ id: `${type}-root`, block: blockOfType(type) });

describe('block selection checkboxes', () => {
  it.each(BLOCK_TYPES)('renders a selectable checkbox for every root block type (%s)', (type) => {
    const onToggleSelect = jest.fn();
    render(
      <BlockItem
        block={rootItem(type)}
        index={0}
        totalBlocks={1}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        onDuplicate={jest.fn()}
        isSelectionMode
        onToggleSelect={onToggleSelect}
      />
    );

    fireEvent.click(screen.getByRole('checkbox'));
    expect(onToggleSelect).toHaveBeenCalledTimes(1);
  });

  it.each(BLOCK_TYPES)('renders a selectable checkbox for every nested block type (%s)', (type) => {
    const onToggleSelect = jest.fn();
    render(
      <NestedBlockItem
        block={blockOfType(type)}
        index={0}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        onDuplicate={jest.fn()}
        isSelectionMode
        onToggleSelect={onToggleSelect}
      />
    );

    fireEvent.click(screen.getByRole('checkbox'));
    expect(onToggleSelect).toHaveBeenCalledTimes(1);
  });
});
