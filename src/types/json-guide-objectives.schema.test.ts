import { parseJsonGuide } from '../docs-retrieval/json-parser';
import { validateGuide } from '../validation';
import { JsonInteractiveBlockSchema, JsonSectionBlockSchema } from './json-guide.schema';

const interactiveGuide = (objectives: string[]) => ({
  id: 'objectives',
  title: 'Objectives',
  blocks: [{ type: 'interactive', action: 'button', reftarget: 'button', content: 'Save', objectives }],
});

describe('executable objectives', () => {
  it.each(['has-dashbord-named:Example', 'Learn about dashboards', ''])(
    'keeps a guide loadable when an objective is not executable: %s',
    (objective) => {
      expect(
        JsonInteractiveBlockSchema.safeParse({
          type: 'interactive',
          action: 'button',
          reftarget: 'button',
          content: 'Save',
          objectives: [objective],
        }).success
      ).toBe(true);

      const parsed = parseJsonGuide(JSON.stringify(interactiveGuide([objective])));
      expect(parsed.isValid).toBe(true);
      expect(
        parsed.data!.elements.find((element) => element.type === 'interactive-step')?.props.objectives
      ).toBeUndefined();
    }
  );

  it('warns about an unexecutable objective instead of failing the guide', () => {
    const result = validateGuide(interactiveGuide(['Learn about dashboards']));
    expect(result.isValid).toBe(true);
    expect(JSON.stringify(result.warnings)).toContain('Learn about dashboards');
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

  it('forwards only the executable objectives to the runtime', () => {
    const parsed = parseJsonGuide(JSON.stringify(interactiveGuide(['Learn about dashboards', 'has-datasource:loki'])));
    expect(parsed.isValid).toBe(true);
    expect(parsed.data!.elements.find((element) => element.type === 'interactive-step')?.props.objectives).toEqual([
      'has-datasource:loki',
    ]);
  });
});
