import { parseJsonGuide } from '../docs-retrieval/json-parser';
import { validateGuide } from '../validation';
import { JsonConditionalBlockSchema, JsonInteractiveBlockSchema, JsonSectionBlockSchema } from './json-guide.schema';
import { isValidRequirement } from './requirements.types';

interface DescribedShape {
  shape: Record<string, { description?: string } | undefined>;
}

const objectivesDescription = (schema: DescribedShape): string => schema.shape.objectives?.description ?? '';

/** The per-branch section config is not exported; reach it through the conditional block that owns it. */
const branchSectionConfig = (): DescribedShape =>
  (JsonConditionalBlockSchema.shape.whenTrueSectionConfig as unknown as { unwrap: () => DescribedShape }).unwrap();

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

  it.each(['has-datasource:prometheus', 'on-page:/explore', 'exists-reftarget'])(
    'forwards a valid objective to the runtime as a completion condition: %s',
    (objective) => {
      const parsed = parseJsonGuide(JSON.stringify(interactiveGuide([objective])));
      expect(parsed.isValid).toBe(true);
      expect(parsed.data!.elements.find((element) => element.type === 'interactive-step')?.props.objectives).toEqual([
        objective,
      ]);
    }
  );

  it('never lets a non-condition objective become completion evidence', () => {
    const objective = 'Learn how to add a data source';
    expect(isValidRequirement(objective)).toBe(false);

    const result = validateGuide(interactiveGuide([objective]));
    expect(result.errors).toEqual([]);
    expect(JSON.stringify(result.warnings)).toContain('Unknown condition type');

    const parsed = parseJsonGuide(JSON.stringify(interactiveGuide([objective])));
    expect(
      parsed.data!.elements.find((element) => element.type === 'interactive-step')?.props.objectives
    ).toBeUndefined();
  });

  it('forwards only the executable objectives to the runtime', () => {
    const parsed = parseJsonGuide(JSON.stringify(interactiveGuide(['Learn about dashboards', 'has-datasource:loki'])));
    expect(parsed.isValid).toBe(true);
    expect(parsed.data!.elements.find((element) => element.type === 'interactive-step')?.props.objectives).toEqual([
      'has-datasource:loki',
    ]);
  });

  // `objectives` is a functional auto-complete condition list, not pedagogical
  // metadata. It was described as "learning objectives" for months, which sent
  // authors to `skippable` for work a reader had already done. These pin the
  // corrected meaning on every surface an agent reads.
  describe.each([
    ['interactive block', () => objectivesDescription(JsonInteractiveBlockSchema), 'block'],
    ['section', () => objectivesDescription(JsonSectionBlockSchema), 'section'],
    ['conditional branch', () => objectivesDescription(branchSectionConfig()), 'branch'],
  ])('%s objectives description', (_label, read, container) => {
    it('describes a condition list rather than learning objectives', () => {
      const description = read();
      expect(description).not.toMatch(/learning objective/i);
      expect(description).toMatch(new RegExp(`automatically complete this ${container}`, 'i'));
    });

    it('points at the requirements vocabulary and the ordering that makes it useful', () => {
      const description = read();
      expect(description).toMatch(/same vocabulary as `requirements`/i);
      expect(description).toMatch(/checked first/i);
    });

    it('carries an example that is itself a valid condition', () => {
      const example = /has-datasource:[\w-]+/.exec(read())?.[0];
      expect(example).toBeDefined();
      expect(isValidRequirement(example!)).toBe(true);
    });
  });

  // Only blocks have `skippable`. Telling a section or a conditional branch to
  // weigh objectives against it points the author at a field their container
  // does not have — the class of error this suite exists to catch.
  it.each([
    ['an interactive block', JsonInteractiveBlockSchema as unknown as DescribedShape],
    ['a section', JsonSectionBlockSchema as unknown as DescribedShape],
    ['a conditional branch', branchSectionConfig()],
  ])('weighs objectives against `skippable` only where %s has one', (_label, schema) => {
    expect(objectivesDescription(schema).includes('`skippable`')).toBe('skippable' in schema.shape);
  });

  it.each([
    ['a section', JsonSectionBlockSchema as unknown as DescribedShape, 'section'],
    ['a conditional branch', branchSectionConfig(), 'branch'],
  ])('closes %s with what completing the container does to its steps', (_label, schema, container) => {
    expect(objectivesDescription(schema)).toContain(
      `When a ${container}'s objectives hold, every step inside it is marked complete too.`
    );
  });
});
