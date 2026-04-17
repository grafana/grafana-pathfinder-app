import {
  buildGuideSystemPrompt,
  extractJsonFromResponse,
  GUIDE_SCHEMA_SUMMARY,
  SELECTOR_BEST_PRACTICES,
  SELECTOR_PLACEHOLDER,
} from './guide-generation.utils';

describe('guide-generation.utils', () => {
  describe('GUIDE_SCHEMA_SUMMARY', () => {
    // Guard against schema drift: the prompt must still reference the
    // required top-level JsonGuide fields and every block type.
    const requiredTopLevel = ['id', 'title', 'blocks'];
    const blockTypes = [
      'markdown',
      'html',
      'section',
      'conditional',
      'interactive',
      'multistep',
      'guided',
      'image',
      'video',
      'quiz',
      'input',
      'terminal',
      'terminal-connect',
      'code-block',
    ];
    const actionTypes = ['highlight', 'button', 'formfill', 'navigate', 'hover', 'noop'];

    it.each(requiredTopLevel)('mentions required top-level field %s', (field) => {
      expect(GUIDE_SCHEMA_SUMMARY).toContain(field);
    });

    it.each(blockTypes)('mentions block type %s', (type) => {
      expect(GUIDE_SCHEMA_SUMMARY).toContain(type);
    });

    it.each(actionTypes)('mentions action type %s', (action) => {
      expect(GUIDE_SCHEMA_SUMMARY).toContain(action);
    });
  });

  describe('SELECTOR_BEST_PRACTICES', () => {
    it('lists data-testid as the highest priority strategy', () => {
      const testidIndex = SELECTOR_BEST_PRACTICES.indexOf('data-testid');
      const nthChildIndex = SELECTOR_BEST_PRACTICES.indexOf('nth-child');
      expect(testidIndex).toBeGreaterThanOrEqual(0);
      expect(nthChildIndex).toBeGreaterThanOrEqual(0);
      expect(testidIndex).toBeLessThan(nthChildIndex);
    });

    it('warns against auto-generated class names', () => {
      expect(SELECTOR_BEST_PRACTICES).toMatch(/css-/);
    });
  });

  describe('buildGuideSystemPrompt', () => {
    it('embeds the schema summary and selector best practices', () => {
      const prompt = buildGuideSystemPrompt();
      expect(prompt).toContain(GUIDE_SCHEMA_SUMMARY);
      expect(prompt).toContain(SELECTOR_BEST_PRACTICES);
    });

    it('tells the model to use the placeholder when selectors are unknown', () => {
      const prompt = buildGuideSystemPrompt();
      expect(prompt).toContain(SELECTOR_PLACEHOLDER);
      expect(prompt).toContain('noop');
    });

    it('requires a JSON-only response', () => {
      const prompt = buildGuideSystemPrompt();
      expect(prompt.toLowerCase()).toContain('json object only');
      expect(prompt.toLowerCase()).toContain('no code fences');
    });

    it('includes previous validation errors on retry', () => {
      const prompt = buildGuideSystemPrompt({
        previousErrors: ['blocks[0].type is required', 'title must be a string'],
      });
      expect(prompt).toContain('blocks[0].type is required');
      expect(prompt).toContain('title must be a string');
    });

    it('omits the retry section when no previous errors are provided', () => {
      const prompt = buildGuideSystemPrompt();
      expect(prompt).not.toContain('previous attempt failed validation');
    });

    it('warns the model that free-form English is not valid in requirements or objectives', () => {
      const prompt = buildGuideSystemPrompt();
      expect(prompt).toMatch(/requirements.+objectives|objectives.+requirements/i);
      expect(prompt.toLowerCase()).toContain('never put free-form english');
    });

    it('prefers the cheap has-datasource check over datasource-configured', () => {
      const prompt = buildGuideSystemPrompt();
      expect(prompt.toLowerCase()).toContain('prefer "has-datasource:');
      expect(prompt.toLowerCase()).toMatch(/avoid.*datasource-configured|configured.+avoid/i);
    });

    it('tells the model to hoist shared requirements rather than repeating them per step', () => {
      const prompt = buildGuideSystemPrompt();
      expect(prompt.toLowerCase()).toContain('shared prerequisites once');
    });

    it('teaches the dropdown / combobox pattern via multistep', () => {
      const prompt = buildGuideSystemPrompt();
      expect(prompt).toContain('Choosing the right interactive pattern');
      expect(prompt).toMatch(/dropdown \/ combobox.*multistep/is);
      expect(prompt).toMatch(/role='listbox'/);
      expect(prompt).toMatch(/role='menu'/);
    });

    it('teaches the modal pattern with role=dialog scoping', () => {
      const prompt = buildGuideSystemPrompt();
      expect(prompt).toMatch(/modal.*formfill/is);
      expect(prompt).toMatch(/role='dialog'/);
    });

    it('teaches radio/toggle targeting via visible label or value', () => {
      const prompt = buildGuideSystemPrompt();
      expect(prompt.toLowerCase()).toMatch(/radio|toggle/);
      expect(prompt).toMatch(/:contains\('Builder'\)|input\[value='builder'\]/);
    });

    it('teaches hover-then-click for menus revealed on hover', () => {
      const prompt = buildGuideSystemPrompt();
      expect(prompt).toMatch(/tooltip|menu.*hover|hover.*button/is);
      expect(prompt).toMatch(/role='tooltip'/);
    });

    it('distinguishes guided (user-led) from multistep (automated)', () => {
      const prompt = buildGuideSystemPrompt();
      expect(prompt).toMatch(/user-led.*guided|guided.*user performs/is);
      expect(prompt).toMatch(/automated.*multistep|multistep.*automated/is);
    });

    it('mentions the <assistant> customization tag for queries / configuration values', () => {
      const prompt = buildGuideSystemPrompt();
      expect(prompt).toContain('<assistant');
      expect(prompt).toMatch(/data-assistant-type="query\|code\|config\|text"|assistantType/);
    });
  });

  describe('extractJsonFromResponse', () => {
    it('returns the JSON when the response is already JSON', () => {
      const input = '{"id":"x","title":"x","blocks":[]}';
      expect(extractJsonFromResponse(input)).toBe(input);
    });

    it('strips ```json code fences', () => {
      const input = '```json\n{"id":"x","title":"y","blocks":[]}\n```';
      expect(extractJsonFromResponse(input)).toBe('{"id":"x","title":"y","blocks":[]}');
    });

    it('strips generic ``` code fences', () => {
      const input = '```\n{"id":"x","title":"y","blocks":[]}\n```';
      expect(extractJsonFromResponse(input)).toBe('{"id":"x","title":"y","blocks":[]}');
    });

    it('trims leading commentary before the opening brace', () => {
      const input = 'Here is the guide:\n{"id":"x","title":"y","blocks":[]}';
      expect(extractJsonFromResponse(input)).toBe('{"id":"x","title":"y","blocks":[]}');
    });

    it('returns null for empty input', () => {
      expect(extractJsonFromResponse('')).toBeNull();
      expect(extractJsonFromResponse('   ')).toBeNull();
    });

    it('returns null when no JSON object is present', () => {
      expect(extractJsonFromResponse('not JSON at all')).toBeNull();
    });
  });
});
