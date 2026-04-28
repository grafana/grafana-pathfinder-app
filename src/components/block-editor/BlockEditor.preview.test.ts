import { buildPreviewGuideForTarget } from './BlockEditor';
import type { EditorBlock, JsonGuide } from './types';

const guide: Pick<JsonGuide, 'id' | 'title'> = {
  id: 'guide-1',
  title: 'Guide title',
};

const sectionBlock: EditorBlock = {
  id: 'section-1',
  block: {
    type: 'section',
    id: 'section-1',
    title: 'Section title',
    blocks: [{ type: 'markdown', content: 'Nested content' }],
  },
};

describe('buildPreviewGuideForTarget', () => {
  it('keeps the section wrapper when previewing a whole section', () => {
    const preview = buildPreviewGuideForTarget(guide, [sectionBlock], {
      type: 'section',
      sectionId: 'section-1',
      source: 'root',
    });

    expect(preview).toEqual({
      id: 'guide-1-section-section-1',
      title: 'Section title',
      blocks: [sectionBlock.block],
    });
  });

  it('previews a nested section block without adding the parent section wrapper', () => {
    const preview = buildPreviewGuideForTarget(guide, [sectionBlock], {
      type: 'section',
      sectionId: 'section-1',
      source: 'nested',
      nestedIndex: 0,
    });

    expect(preview).toEqual({
      id: 'guide-1-section-section-1-nested-0',
      title: 'Section title',
      blocks: [{ type: 'markdown', content: 'Nested content' }],
    });
  });
});
