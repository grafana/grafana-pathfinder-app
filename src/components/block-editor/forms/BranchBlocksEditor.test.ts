import { ALLOWED_BRANCH_BLOCK_TYPES, createDefaultBlock, type BranchBlocksEditorProps } from './BranchBlocksEditor';

type AddableBlockTypes = NonNullable<BranchBlocksEditorProps['addableBlockTypes']>;

const buildablePropTypes: AddableBlockTypes = ['markdown', 'guided'];
// @ts-expect-error challenge has a builder but cannot be edited through this picker
const nonAddableBuilderType: AddableBlockTypes = ['challenge'];
// @ts-expect-error terminal has no intentional default builder
const fallbackOnlyPropTypes: AddableBlockTypes = ['terminal'];

void buildablePropTypes;
void nonAddableBuilderType;
void fallbackOnlyPropTypes;

describe('BranchBlocksEditor createDefaultBlock', () => {
  it('offers exactly the block types the branch add picker can build', () => {
    expect(ALLOWED_BRANCH_BLOCK_TYPES).toEqual([
      'markdown',
      'divider',
      'interactive',
      'image',
      'video',
      'input',
      'callout',
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

  it('does not offer challenge without an inline editor', () => {
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

  it('builds an empty divider block', () => {
    expect(createDefaultBlock('divider')).toEqual({ type: 'divider' });
  });

  it('keeps the legacy fallback for non-defaultable block types', () => {
    expect(createDefaultBlock('terminal')).toEqual({ type: 'markdown', content: '' });
  });

  it('builds an empty callout block, not empty markdown', () => {
    expect(createDefaultBlock('callout')).toEqual({
      type: 'callout',
      title: '',
      content: '',
    });
  });
});
