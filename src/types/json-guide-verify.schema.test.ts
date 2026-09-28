import { parseJsonGuide } from '../docs-retrieval/json-parser';
import { validateGuide } from '../validation';
import { JsonInteractiveBlockSchema } from './json-guide.schema';

const CSS_SELECTOR = "[data-testid='data-testid Data source settings page Save and Test button']";

const parse = (verify: string) =>
  JsonInteractiveBlockSchema.safeParse({
    type: 'interactive',
    action: 'button',
    reftarget: 'Save & test',
    content: 'Save the data source',
    verify,
  });

const verifyGuide = (verify: string) => ({
  id: 'verify',
  title: 'Verify',
  blocks: [
    { type: 'interactive', action: 'button', reftarget: 'Save & test', content: 'Save the data source', verify },
  ],
});

const postVerify = (verify: string): unknown => {
  const parsed = parseJsonGuide(JSON.stringify(verifyGuide(verify)));
  return parsed.data!.elements.find((element) => element.type === 'interactive-step')?.props.postVerify;
};

function verifyDescription(): string {
  const { shape } = JsonInteractiveBlockSchema as unknown as { shape: Record<string, { description?: string }> };
  return shape.verify?.description ?? '';
}

describe('interactive verify', () => {
  // The three token shapes that appear across the published packages in
  // grafana/interactive-tutorials.
  it.each([
    'on-page:/connections/datasources/edit',
    'dashboard-exists',
    'has-datasource:grafanacloud-play-profiles',
    // The comma-separated form `conditionTokens` splits at runtime.
    'on-page:/explore, exists-reftarget',
  ])('takes a condition token without complaint: %s', (verify) => {
    expect(parse(verify).success).toBe(true);
    expect(validateGuide(verifyGuide(verify)).warnings).toEqual([]);
  });

  // `verify` was documented as a CSS selector for its whole shipped history,
  // and `upsert-learning-path.sh` forwards it to the InteractiveGuide CRD
  // unchecked, so a stack can hold one. `backend-guide.ts` re-validates that
  // guide at render time: a schema rejection would blank it for the reader.
  it.each([CSS_SELECTOR, '#save-button', 'on-page:/explore, #save-button'])(
    'keeps a guide loadable when verify is not a condition: %s',
    (verify) => {
      expect(parse(verify).success).toBe(true);

      const result = validateGuide(verifyGuide(verify));
      expect(result.isValid).toBe(true);
      expect(result.guide).not.toBeNull();
    }
  );

  it('warns about a CSS selector instead of failing the guide', () => {
    const result = validateGuide(verifyGuide(CSS_SELECTOR));
    expect(result.errors).toEqual([]);
    expect(JSON.stringify(result.warnings)).toContain('Unknown condition type');
    expect(JSON.stringify(result.warnings)).toContain('blocks[0].verify');
  });

  it('warns about one unknown token in an otherwise valid list', () => {
    const result = validateGuide(verifyGuide('on-page:/explore, #save-button'));
    expect(result.errors).toEqual([]);
    expect(JSON.stringify(result.warnings)).toContain("Unknown condition type '#save-button'");
  });

  // The authoring gates run `--strict`, which is where a selector should stop.
  it('fails strict validation, which is what the authoring gates run', () => {
    const result = validateGuide(verifyGuide(CSS_SELECTOR), { strict: true });
    expect(result.isValid).toBe(false);
    expect(JSON.stringify(result.errors)).toContain('Unknown condition type');
  });

  // Unlike an objective, an unrecognised verify is not dropped on the way to
  // the runtime: `routeUnifiedCheck` returns verdict `invalid` in `post` mode,
  // so the step refuses to complete rather than completing on no evidence.
  it('forwards verify to the runtime verbatim, condition or not', () => {
    expect(postVerify('on-page:/explore')).toBe('on-page:/explore');
    expect(postVerify(CSS_SELECTOR)).toBe(CSS_SELECTOR);
  });

  it('describes a condition, and its own example is one', () => {
    const description = verifyDescription();
    expect(description).toMatch(/verification condition/i);
    expect(description).toMatch(/not a CSS selector/i);

    const example = /on-page:[\w/.-]+/.exec(description)?.[0];
    expect(example).toBeDefined();
    expect(validateGuide(verifyGuide(example!)).warnings).toEqual([]);
  });
});
