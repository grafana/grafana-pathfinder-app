import { getProjectionRow, isTranslatableBlockType, PROJECTION_TABLE, readProjectedField } from './projection-table';

describe('PROJECTION_TABLE', () => {
  it('holds exactly the v1 rows of docs/design/I18N.md §7.1', () => {
    expect(PROJECTION_TABLE).toEqual({
      markdown: { fields: ['content'] },
      interactive: { fields: ['content', 'tooltip', 'hint', 'formHint'] },
      section: { fields: ['title'] },
      conditional: { fields: ['description', 'whenTrueSectionConfig.title', 'whenFalseSectionConfig.title'] },
      multistep: { fields: ['content'], stepFields: ['description', 'tooltip', 'formHint'] },
      guided: { fields: ['content'], stepFields: ['description', 'tooltip', 'formHint'] },
      image: { fields: ['alt'] },
      video: { fields: ['title'] },
    });
  });

  it.each(['quiz', 'challenge', 'html', 'grot-guide', 'terminal', 'snippet-ref', 'callout', 'divider'])(
    'leaves %s out of the table',
    (type) => {
      expect(isTranslatableBlockType(type)).toBe(false);
      expect(getProjectionRow(type)).toBeUndefined();
    }
  );

  it('does not treat inherited object keys as block types', () => {
    expect(isTranslatableBlockType('constructor')).toBe(false);
    expect(isTranslatableBlockType('toString')).toBe(false);
  });
});

describe('readProjectedField', () => {
  it('reads a top-level string field', () => {
    expect(readProjectedField({ content: 'Hello' }, 'content')).toBe('Hello');
  });

  it('follows a dotted field into a nested object', () => {
    expect(readProjectedField({ whenTrueSectionConfig: { title: 'Ready' } }, 'whenTrueSectionConfig.title')).toBe(
      'Ready'
    );
  });

  it.each([
    ['an absent field', {}, 'content'],
    ['a non-string value', { content: 5 }, 'content'],
    ['an absent parent', {}, 'whenTrueSectionConfig.title'],
    ['a null parent', { whenTrueSectionConfig: null }, 'whenTrueSectionConfig.title'],
    ['an inherited key', {}, 'toString'],
  ])('reads %s as absent', (_label, source, field) => {
    expect(readProjectedField(source, field)).toBeUndefined();
  });
});
