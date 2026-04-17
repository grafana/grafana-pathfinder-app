/**
 * @jest-environment jsdom
 */

import { buildElementContext, buildSelectorSystemPrompt, selectorStillMatches } from './selector-generation.utils';

function makeDom(html: string): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = html.trim();
  document.body.appendChild(container);
  return container;
}

describe('selector-generation.utils', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('buildElementContext', () => {
    it('captures tag, testid, aria, and visible text from a button', () => {
      const container = makeDom(`
        <div data-testid="toolbar">
          <button data-testid="save-dashboard" aria-label="Save" role="button">Save dashboard</button>
        </div>
      `);
      const button = container.querySelector<HTMLElement>('[data-testid="save-dashboard"]')!;

      const ctx = buildElementContext(button, 'button[data-testid="save-dashboard"]');

      expect(ctx.tag).toBe('button');
      expect(ctx.testId).toBe('save-dashboard');
      expect(ctx.ariaLabel).toBe('Save');
      expect(ctx.role).toBe('button');
      expect(ctx.text).toBe('Save dashboard');
      expect(ctx.candidates[0]).toBe('button[data-testid="save-dashboard"]');
    });

    it('skips emotion-style auto-generated classes', () => {
      const container = makeDom(`
        <button class="css-abc1234 save-button my-component">Save</button>
      `);
      const button = container.querySelector<HTMLElement>('button')!;

      const ctx = buildElementContext(button, 'button');

      expect(ctx.classes).toContain('save-button');
      expect(ctx.classes).toContain('my-component');
      expect(ctx.classes).not.toContain('css-abc1234');
    });

    it('captures stable ancestors with test ids', () => {
      const container = makeDom(`
        <section data-testid="panel-editor">
          <div data-testid="query-editor">
            <button>Run query</button>
          </div>
        </section>
      `);
      const button = container.querySelector<HTMLElement>('button')!;

      const ctx = buildElementContext(button, 'button');

      const testIds = ctx.ancestors.map((a) => a.testId).filter(Boolean);
      expect(testIds).toEqual(expect.arrayContaining(['query-editor', 'panel-editor']));
    });

    it('includes the current selector as the first candidate', () => {
      const container = makeDom(`<button data-testid="foo">Foo</button>`);
      const button = container.querySelector<HTMLElement>('button')!;

      const ctx = buildElementContext(button, 'button[data-testid="foo"]');

      expect(ctx.candidates[0]).toBe('button[data-testid="foo"]');
    });

    it('populates fullDomPath from root down to the target', () => {
      const container = makeDom(`
        <div data-testid="panel">
          <form>
            <button data-testid="save">Save</button>
          </form>
        </div>
      `);
      const btn = container.querySelector<HTMLElement>('button')!;
      const ctx = buildElementContext(btn, "button[data-testid='save']");

      expect(ctx.fullDomPath.length).toBeGreaterThan(0);
      const last = ctx.fullDomPath[ctx.fullDomPath.length - 1]!;
      expect(last).toContain('button');
      expect(last).toContain("data-testid='save'");

      // Somewhere in the chain we should see the panel ancestor.
      expect(ctx.fullDomPath.some((node) => node.includes("data-testid='panel'"))).toBe(true);
    });

    it('records sibling tags, text, and values for form controls', () => {
      const container = makeDom(`
        <div>
          <input type="radio" value="left" />
          <input type="radio" value="right" />
          <label>Alignment</label>
        </div>
      `);
      const left = container.querySelector<HTMLInputElement>('input[value="left"]')!;
      const ctx = buildElementContext(left, "input[value='left']");

      expect(ctx.siblings.length).toBeGreaterThan(0);
      const tags = ctx.siblings.map((s) => s.tag);
      expect(tags).toEqual(expect.arrayContaining(['input', 'label']));
      const rightSib = ctx.siblings.find((s) => s.value === 'right');
      expect(rightSib).toBeDefined();
      const labelSib = ctx.siblings.find((s) => s.tag === 'label');
      expect(labelSib?.text).toBe('Alignment');
    });

    it('exposes input value and type on the context', () => {
      const container = makeDom(`<input type="radio" value="builder" />`);
      const input = container.querySelector<HTMLElement>('input')!;
      const ctx = buildElementContext(input, 'input');
      expect(ctx.value).toBe('builder');
      expect(ctx.inputType).toBe('radio');
    });
  });

  describe('buildSelectorSystemPrompt', () => {
    it('includes the action, tag, candidates, and best-practices block', () => {
      const container = makeDom(`
        <button data-testid="save" aria-label="Save">Save</button>
      `);
      const button = container.querySelector<HTMLElement>('button')!;
      const context = buildElementContext(button, 'button[data-testid="save"]');

      const prompt = buildSelectorSystemPrompt({ action: 'button', context });

      expect(prompt).toContain('Action the selector will drive: button');
      expect(prompt).toContain('data-testid="save"');
      expect(prompt).toContain('data-testid');
      expect(prompt).toContain('button[data-testid="save"]');
      expect(prompt).toContain('Selector priority for reftarget');
    });

    it('tells the model to return the selector only', () => {
      const container = makeDom(`<button>Foo</button>`);
      const button = container.querySelector<HTMLElement>('button')!;
      const context = buildElementContext(button, 'button');

      const prompt = buildSelectorSystemPrompt({ action: 'highlight', context });

      expect(prompt).toContain('Return the selector string ONLY');
      expect(prompt).toContain('no code fences');
    });

    it('falls back gracefully when there are no candidates', () => {
      const container = makeDom(`<span>stray</span>`);
      const span = container.querySelector<HTMLElement>('span')!;
      const context = { ...buildElementContext(span, 'span'), candidates: [] };

      const prompt = buildSelectorSystemPrompt({ action: 'hover', context });

      expect(prompt).toContain('(no candidates');
    });

    it('renders the full DOM path section', () => {
      const container = makeDom(`
        <div data-testid="panel">
          <div role="radiogroup">
            <input type="radio" value="builder" />
          </div>
        </div>
      `);
      const input = container.querySelector<HTMLElement>('input')!;
      const context = buildElementContext(input, "input[value='builder']");
      const prompt = buildSelectorSystemPrompt({ action: 'button', context });

      expect(prompt).toContain('DOM path from document root');
      expect(prompt).toMatch(/data-testid='panel'/);
      expect(prompt).toMatch(/role='radiogroup'/);
      expect(prompt).toMatch(/value='builder'/);
    });

    it('strips ephemeral classes from the DOM path', () => {
      const container = makeDom(`
        <div class="css-abc123 panel">
          <button>ok</button>
        </div>
      `);
      const btn = container.querySelector<HTMLElement>('button')!;
      const context = buildElementContext(btn, 'button');
      const pathBlob = context.fullDomPath.join('\n');
      expect(pathBlob).not.toContain('css-abc123');
      expect(pathBlob).toContain('panel');
    });

    it('renders the sibling section with label/value context', () => {
      const container = makeDom(`
        <div>
          <label>Dashboard title</label>
          <input type="text" />
        </div>
      `);
      const input = container.querySelector<HTMLInputElement>('input')!;
      const context = buildElementContext(input, 'input');
      const prompt = buildSelectorSystemPrompt({ action: 'formfill', context });

      expect(prompt).toContain('Stable siblings');
      expect(prompt).toMatch(/Dashboard title/);
    });

    it('instructs the model to use attribute-prefix and sibling combinators', () => {
      const container = makeDom(`<input type="text" />`);
      const input = container.querySelector<HTMLElement>('input')!;
      const prompt = buildSelectorSystemPrompt({
        action: 'formfill',
        context: buildElementContext(input, 'input'),
      });
      expect(prompt).toMatch(/attribute-prefix matching/i);
      expect(prompt).toMatch(/sibling combinators/i);
      expect(prompt).toMatch(/role='dialog'/);
    });
  });

  describe('selectorStillMatches', () => {
    it('returns true when the selector still points at the expected element', () => {
      const container = makeDom(`<button data-testid="foo">Foo</button>`);
      const button = container.querySelector<HTMLElement>('button')!;

      expect(selectorStillMatches('button[data-testid="foo"]', button)).toBe(true);
    });

    it('returns false when the selector resolves to a different element', () => {
      const container = makeDom(`
        <button data-testid="foo">Foo</button>
        <button data-testid="bar">Bar</button>
      `);
      const foo = container.querySelector<HTMLElement>('[data-testid="foo"]')!;

      expect(selectorStillMatches('button[data-testid="bar"]', foo)).toBe(false);
    });

    it('returns false for empty or invalid selectors', () => {
      const container = makeDom(`<button>Foo</button>`);
      const button = container.querySelector<HTMLElement>('button')!;

      expect(selectorStillMatches('', button)).toBe(false);
      expect(selectorStillMatches('button[data-testid=', button)).toBe(false);
    });
  });
});
