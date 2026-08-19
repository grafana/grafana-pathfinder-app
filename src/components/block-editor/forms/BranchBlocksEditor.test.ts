import { ALLOWED_BRANCH_BLOCK_TYPES, createDefaultBlock, type BranchBlocksEditorProps } from './BranchBlocksEditor';

const validProps: BranchBlocksEditorProps = {
  label: 'Branch',
  variant: 'success',
  blocks: [],
  onChange: () => undefined,
  addableBlockTypes: ['markdown', 'guided'],
};

const invalidProps: BranchBlocksEditorProps = {
  ...validProps,
  // @ts-expect-error challenge has a dedicated editor and cannot be built by the branch add picker
  addableBlockTypes: ['challenge'],
};

void invalidProps;

if (false) {
  // @ts-expect-error collapsible has no default builder
  createDefaultBlock('collapsible');
}

describe('BranchBlocksEditor createDefaultBlock', () => {
  it('offers exactly the block types the inline picker can build', () => {
    expect(ALLOWED_BRANCH_BLOCK_TYPES).toEqual([
      'markdown',
      'interactive',
      'image',
      'video',
      'input',
      'quiz',
      'multistep',
      'guided',
    ]);
  });

  it('constructs every offered block without changing its type', () => {
    for (const type of ALLOWED_BRANCH_BLOCK_TYPES) {
      expect(createDefaultBlock(type).type).toBe(type);
    }
  });
});
