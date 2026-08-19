import {
  ALLOWED_BRANCH_BLOCK_TYPES,
  createDefaultBlock,
  type BranchBlocksEditorProps,
} from './BranchBlocksEditor';

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

describe('BranchBlocksEditor createDefaultBlock', () => {
  it('does not offer challenge in the inline add picker', () => {
    expect(ALLOWED_BRANCH_BLOCK_TYPES).not.toContain('challenge');
  });

  it('builds a challenge block instead of empty markdown if challenged', () => {
    expect(createDefaultBlock('challenge')).toEqual({
      type: 'challenge',
      title: '',
      brief: '',
      successCriteria: '',
    });
  });

  it('still defaults unknown types to empty markdown', () => {
    // html is legacy / palette-excluded and not in the creatable list
    expect(createDefaultBlock('html' as any)).toEqual({ type: 'markdown', content: '' });
  });
});
