import { JsonInteractiveBlockSchema } from './json-guide.schema';

const parse = (verify: string) =>
  JsonInteractiveBlockSchema.safeParse({
    type: 'interactive',
    action: 'button',
    reftarget: 'Save & test',
    content: 'Save the data source',
    verify,
  });

function verifyDescription(): string {
  const { shape } = JsonInteractiveBlockSchema as unknown as { shape: Record<string, { description?: string }> };
  return shape.verify?.description ?? '';
}

describe('interactive verify', () => {
  // The three token shapes that appear across the published packages in
  // grafana/interactive-tutorials. A refinement that rejects any of them would
  // break guides that are already live.
  it.each(['on-page:/connections/datasources/edit', 'dashboard-exists', 'has-datasource:grafanacloud-play-profiles'])(
    'accepts a condition token that published guides already use: %s',
    (verify) => {
      expect(parse(verify).success).toBe(true);
    }
  );

  it('accepts the comma-separated form the runtime tokenizes', () => {
    expect(parse('on-page:/explore, exists-reftarget').success).toBe(true);
  });

  it('rejects a CSS selector', () => {
    const result = parse("[data-testid='data-testid Data source settings page Save and Test button']");
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error!.issues)).toContain('Unknown requirement');
  });

  it('rejects one unknown token in an otherwise valid list', () => {
    expect(parse('on-page:/explore, #save-button').success).toBe(false);
  });

  it('describes a condition, and its own example parses', () => {
    const description = verifyDescription();
    expect(description).toMatch(/verification condition/i);

    const example = /on-page:[\w/.-]+/.exec(description)?.[0];
    expect(example).toBeDefined();
    expect(parse(example!).success).toBe(true);
  });
});
