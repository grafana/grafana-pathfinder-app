import { JsonInteractiveBlockSchema, JsonSectionBlockSchema } from './json-guide.schema';

describe('executable objectives', () => {
  it.each(['has-dashbord-named:Example', 'Learn about dashboards', ''])('rejects %s', (objective) => {
    expect(
      JsonInteractiveBlockSchema.safeParse({
        type: 'interactive',
        action: 'button',
        reftarget: 'button',
        content: 'Save',
        objectives: [objective],
      }).success
    ).toBe(false);
  });

  it('accepts a recognised section objective', () => {
    expect(
      JsonSectionBlockSchema.safeParse({
        type: 'section',
        blocks: [{ type: 'markdown', content: 'Connect a source' }],
        objectives: ['has-datasource:testdata'],
      }).success
    ).toBe(true);
  });
});
