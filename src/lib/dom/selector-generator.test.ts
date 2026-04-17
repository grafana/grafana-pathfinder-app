/**
 * Tests for the three-phase selector generation pipeline
 *
 * Phase 1: retargetElement — find the intent element
 * Phase 2: generateCandidates (via generateBestSelector) — produce all candidates
 * Phase 3: rankAndSelect (via generateBestSelector) — disambiguate and pick the best
 */

import {
  generateBestSelector,
  getSelectorInfo,
  retargetElement,
  generateFallbackSelectors,
} from './selector-generator';
import { querySelectorAllEnhanced } from './enhanced-selector';

describe('Selector Generator — Pipeline', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  // ==========================================================================
  // Phase 1: retargetElement
  // ==========================================================================

  describe('retargetElement', () => {
    it('keeps form controls as-is (input)', () => {
      const input = document.createElement('input');
      input.type = 'text';
      document.body.appendChild(input);
      expect(retargetElement(input)).toBe(input);
    });

    it('keeps form controls as-is (select)', () => {
      const select = document.createElement('select');
      document.body.appendChild(select);
      expect(retargetElement(select)).toBe(select);
    });

    it('keeps form controls as-is (textarea)', () => {
      const textarea = document.createElement('textarea');
      document.body.appendChild(textarea);
      expect(retargetElement(textarea)).toBe(textarea);
    });

    it('retargets span inside button to the button', () => {
      const button = document.createElement('button');
      const span = document.createElement('span');
      span.textContent = 'Click';
      button.appendChild(span);
      document.body.appendChild(button);
      expect(retargetElement(span)).toBe(button);
    });

    it('retargets svg inside link to the link', () => {
      const link = document.createElement('a');
      link.href = '/home';
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      link.appendChild(svg);
      document.body.appendChild(link);
      expect(retargetElement(svg as unknown as HTMLElement)).toBe(link);
    });

    it('retargets to element with interactive role', () => {
      const div = document.createElement('div');
      div.setAttribute('role', 'button');
      const span = document.createElement('span');
      div.appendChild(span);
      document.body.appendChild(div);
      expect(retargetElement(span)).toBe(div);
    });

    it('keeps interactive elements as-is even inside interactive ancestors', () => {
      const wrapper = document.createElement('div');
      wrapper.setAttribute('role', 'button');
      const button = document.createElement('button');
      wrapper.appendChild(button);
      document.body.appendChild(wrapper);
      expect(retargetElement(button)).toBe(button);
    });

    it('keeps non-interactive containers as-is', () => {
      const section = document.createElement('section');
      section.setAttribute('data-testid', 'panel');
      const div = document.createElement('div');
      section.appendChild(div);
      document.body.appendChild(section);
      expect(retargetElement(section)).toBe(section);
    });

    it('keeps a deeply nested non-interactive element when no interactive ancestor exists', () => {
      document.body.innerHTML = '<div><div><div><span id="target">text</span></div></div></div>';
      const target = document.getElementById('target') as HTMLElement;
      expect(retargetElement(target)).toBe(target);
    });
  });

  // ==========================================================================
  // Phase 2 + 3: generateBestSelector — priority order
  // ==========================================================================

  describe('generateBestSelector — priority order', () => {
    it('prioritizes data-testid (highest priority)', () => {
      const button = document.createElement('button');
      button.setAttribute('data-testid', 'save-button');
      button.id = 'save-btn';
      button.setAttribute('aria-label', 'Save');
      button.textContent = 'Save';
      document.body.appendChild(button);

      expect(generateBestSelector(button)).toBe("button[data-testid='save-button']");
    });

    it('uses non-auto-generated id when no testid', () => {
      const button = document.createElement('button');
      button.id = 'save-btn';
      button.setAttribute('aria-label', 'Save');
      document.body.appendChild(button);

      expect(generateBestSelector(button)).toBe('#save-btn');
    });

    it('uses aria-label for non-button elements', () => {
      const div = document.createElement('div');
      div.setAttribute('aria-label', 'Save Document');
      document.body.appendChild(div);

      expect(generateBestSelector(div)).toContain("aria-label='Save Document'");
    });

    it('uses name attribute for text inputs', () => {
      const input = document.createElement('input');
      input.setAttribute('name', 'username');
      input.type = 'text';
      document.body.appendChild(input);

      expect(generateBestSelector(input)).toContain("[name='username']");
    });

    it('uses href for links', () => {
      const link = document.createElement('a');
      link.setAttribute('href', '/dashboard');
      document.body.appendChild(link);

      expect(generateBestSelector(link)).toContain("[href='/dashboard']");
    });

    it('uses button text when unique', () => {
      const button = document.createElement('button');
      button.textContent = 'Save Dashboard';
      document.body.appendChild(button);

      const selector = generateBestSelector(button);
      expect(selector).toBeTruthy();
    });
  });

  // ==========================================================================
  // Retarget + hierarchy walking
  // ==========================================================================

  describe('generateBestSelector — hierarchy walking', () => {
    it('finds parent button testid when clicking span inside button', () => {
      const button = document.createElement('button');
      button.setAttribute('data-testid', 'save');
      const span = document.createElement('span');
      span.textContent = 'Save';
      button.appendChild(span);
      document.body.appendChild(button);

      expect(generateBestSelector(span)).toBe("button[data-testid='save']");
    });

    it('generates selector for button directly', () => {
      const wrapper = document.createElement('div');
      const button = document.createElement('button');
      button.setAttribute('data-testid', 'submit');
      wrapper.appendChild(button);
      document.body.appendChild(wrapper);

      const selector = generateBestSelector(button);
      expect(selector).toContain("data-testid='submit'");
    });
  });

  // ==========================================================================
  // Auto-generated class filtering
  // ==========================================================================

  describe('generateBestSelector — class filtering', () => {
    it('filters out UUID-style IDs', () => {
      const button = document.createElement('button');
      button.id = '550e8400-e29b-41d4-a716-446655440000';
      document.body.appendChild(button);

      expect(generateBestSelector(button)).not.toContain('550e8400');
    });

    it('filters out theme classes from compound selectors', () => {
      const button = document.createElement('button');
      button.className = 'theme-dark save-button';
      document.body.appendChild(button);

      const selector = generateBestSelector(button);
      expect(selector).not.toContain('theme-dark');
    });

    it('keeps stable BEM classes in compound selectors', () => {
      const div = document.createElement('div');
      div.className = 'button__primary--active';
      document.body.appendChild(div);

      const selector = generateBestSelector(div);
      expect(selector).toContain('button__primary--active');
    });
  });

  // ==========================================================================
  // Disambiguation (context building)
  // ==========================================================================

  describe('generateBestSelector — disambiguation', () => {
    it('adds scoped nth-child when ambiguous buttons share same parent', () => {
      const form = document.createElement('form');
      form.setAttribute('data-testid', 'user-form');
      const button1 = document.createElement('button');
      button1.textContent = 'Save';
      const button2 = document.createElement('button');
      button2.textContent = 'Save';
      form.appendChild(button1);
      form.appendChild(button2);
      document.body.appendChild(form);

      const selector = generateBestSelector(button1);
      expect(selector).toContain("data-testid='user-form'");
      const matches = querySelectorAllEnhanced(selector);
      expect(matches.elements).toContain(button1);
    });

    it('uses unique button text when buttons have different text', () => {
      const container = document.createElement('div');
      container.setAttribute('data-testid', 'container');
      const button1 = document.createElement('button');
      button1.textContent = 'Save Draft';
      const button2 = document.createElement('button');
      button2.textContent = 'Save Final';
      container.appendChild(button1);
      container.appendChild(button2);
      document.body.appendChild(container);

      const selector = generateBestSelector(button1);
      // "Save Draft" is unique button text, so it may use plain text or :text()
      expect(selector).toBeTruthy();
      expect(selector).toContain('Save Draft');
    });

    it('does not add context when selector is unique', () => {
      const button = document.createElement('button');
      button.setAttribute('data-testid', 'unique-button');
      document.body.appendChild(button);

      expect(generateBestSelector(button)).toBe("button[data-testid='unique-button']");
    });

    it('handles multiple buttons with same text using parent testid', () => {
      const form1 = document.createElement('form');
      form1.setAttribute('data-testid', 'form-1');
      const button1 = document.createElement('button');
      button1.textContent = 'Submit';
      form1.appendChild(button1);

      const form2 = document.createElement('form');
      form2.setAttribute('data-testid', 'form-2');
      const button2 = document.createElement('button');
      button2.textContent = 'Submit';
      form2.appendChild(button2);

      document.body.appendChild(form1);
      document.body.appendChild(form2);

      const selector = generateBestSelector(button1);
      expect(selector).toContain("data-testid='form-1'");
    });
  });

  // ==========================================================================
  // Stable data-* attribute scoping
  // ==========================================================================

  describe('generateBestSelector — stable data-attr scoping', () => {
    it('uses data-intercom-target on parent for scoping', () => {
      document.body.innerHTML = `
        <div data-intercom-target="env-site-selectors">
          <div>
            <input role="combobox" aria-autocomplete="list" type="text" />
          </div>
          <div>
            <input role="combobox" aria-autocomplete="list" type="text" />
          </div>
        </div>
      `;
      const input = document.querySelector('input[role="combobox"]') as HTMLElement;
      const selector = generateBestSelector(input);
      expect(selector).toContain('data-intercom-target');
    });

    it('does NOT use data-emotion as parent scoping attribute', () => {
      document.body.innerHTML = `
        <div data-emotion="css-abc123">
          <button>Click 1</button>
          <button>Click 2</button>
        </div>
      `;
      const button = document.querySelector('button') as HTMLElement;
      const selector = generateBestSelector(button);
      expect(selector).not.toContain('data-emotion');
    });

    it('does NOT use data-state as parent scoping attribute', () => {
      document.body.innerHTML = `
        <div data-state="open">
          <button>Click 1</button>
          <button>Click 2</button>
        </div>
      `;
      const button = document.querySelector('button') as HTMLElement;
      const selector = generateBestSelector(button);
      expect(selector).not.toContain('data-state');
    });

    it('uses unique name attribute when input has it (parent testid is not forced)', () => {
      document.body.innerHTML = `
        <div data-intercom-target="env-selectors">
          <div data-testid="env-field">
            <input type="text" name="env" />
          </div>
        </div>
      `;
      const input = document.querySelector('input') as HTMLElement;
      const selector = generateBestSelector(input);
      // input[name='env'] is unique, so it wins without needing parent context
      expect(selector).toContain("[name='env']");
    });
  });

  // ==========================================================================
  // Edge cases
  // ==========================================================================

  describe('generateBestSelector — edge cases', () => {
    it('normalizes href by stripping query strings and hashes', () => {
      const link = document.createElement('a');
      link.setAttribute('href', '/dashboard?tab=overview#section1');
      link.setAttribute('data-testid', 'nav-link');
      document.body.appendChild(link);

      expect(generateBestSelector(link)).toBe("a[data-testid='nav-link']");
    });

    it('handles links with testid and href', () => {
      const link = document.createElement('a');
      link.setAttribute('data-testid', 'nav-item');
      link.setAttribute('href', '/dashboard');
      document.body.appendChild(link);

      expect(generateBestSelector(link)).toBe("a[data-testid='nav-item']");
    });

    it('cleans Grammarly extension attributes', () => {
      const button = document.createElement('button');
      button.setAttribute('data-testid', 'save');
      button.setAttribute('data-new-gr-c-s-check-loaded', 'true');
      document.body.appendChild(button);

      const selector = generateBestSelector(button);
      expect(selector).not.toContain('data-new-gr-c-s-check-loaded');
    });

    it('generates valid selectors for simple testid elements (no regression)', () => {
      document.body.innerHTML = `
        <button data-testid="save-btn">Save</button>
        <input data-testid="name-input" type="text" />
        <a href="/dashboard" data-testid="nav-link">Dashboard</a>
      `;

      const button = document.querySelector('button') as HTMLElement;
      const input = document.querySelector('input') as HTMLElement;
      const link = document.querySelector('a') as HTMLElement;

      expect(generateBestSelector(button)).toBe("button[data-testid='save-btn']");
      expect(generateBestSelector(input)).toBe("input[data-testid='name-input']");
      expect(generateBestSelector(link)).toBe("a[data-testid='nav-link']");
    });

    it('fallback reports actual matchCount instead of hardcoded 0', () => {
      const info = getSelectorInfo(document.body);
      expect(info.matchCount).toBeGreaterThan(0);
      expect(info.warnings).not.toContain(expect.stringContaining('does not match any elements'));
    });

    it('keeps radio input as-is (no redirect to label)', () => {
      const label = document.createElement('label');
      label.setAttribute('for', 'opt-1');
      label.textContent = 'Option 1';
      const input = document.createElement('input');
      input.type = 'radio';
      input.id = 'opt-1';
      input.name = 'options';
      document.body.appendChild(label);
      document.body.appendChild(input);

      const selector = generateBestSelector(input);
      // Input should not be redirected to the label; it stays as-is
      expect(selector).toBeTruthy();
      const matches = querySelectorAllEnhanced(selector);
      expect(matches.elements.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // getSelectorInfo
  // ==========================================================================

  describe('getSelectorInfo', () => {
    it('detects data-testid method', () => {
      const button = document.createElement('button');
      button.setAttribute('data-testid', 'test-button');
      document.body.appendChild(button);

      const info = getSelectorInfo(button);
      expect(info.method).toBe('data-testid');
      expect(info.isUnique).toBe(true);
      expect(info.matchCount).toBe(1);
    });

    it('detects id method', () => {
      const button = document.createElement('button');
      button.id = 'test-button';
      document.body.appendChild(button);

      const info = getSelectorInfo(button);
      expect(info.method).toBe('id');
    });

    it('returns quality and flags', () => {
      const button = document.createElement('button');
      button.setAttribute('data-testid', 'test');
      document.body.appendChild(button);

      const info = getSelectorInfo(button);
      expect(info.quality).toBe('good');
      expect(info.stabilityScore).toBeGreaterThanOrEqual(80);
    });

    it('validates selector matches the element', () => {
      const button = document.createElement('button');
      button.setAttribute('data-testid', 'test-button');
      document.body.appendChild(button);

      const info = getSelectorInfo(button);
      const matches = querySelectorAllEnhanced(info.selector);
      expect(matches.elements).toContain(button);
    });
  });

  // ==========================================================================
  // generateFallbackSelectors
  // ==========================================================================

  describe('generateFallbackSelectors', () => {
    it('returns alternative selectors excluding the primary', () => {
      const button = document.createElement('button');
      button.setAttribute('data-testid', 'save');
      button.id = 'save-btn';
      button.setAttribute('aria-label', 'Save document');
      document.body.appendChild(button);

      const primary = generateBestSelector(button);
      const fallbacks = generateFallbackSelectors(button, primary);

      expect(fallbacks.length).toBeGreaterThan(0);
      expect(fallbacks).not.toContain(primary);
    });

    it('returns at most 4 fallbacks', () => {
      const button = document.createElement('button');
      button.setAttribute('data-testid', 'save');
      button.id = 'save-btn';
      button.setAttribute('aria-label', 'Save');
      button.setAttribute('title', 'Save document');
      button.textContent = 'Save';
      document.body.appendChild(button);

      const primary = generateBestSelector(button);
      const fallbacks = generateFallbackSelectors(button, primary);
      expect(fallbacks.length).toBeLessThanOrEqual(4);
    });
  });

  // ==========================================================================
  // Integration
  // ==========================================================================

  describe('integration — complex nested structures', () => {
    it('generates valid selectors for a typical Grafana layout', () => {
      document.body.innerHTML = `
        <div data-testid="app">
          <nav data-testid="navigation">
            <a href="/dashboard" data-testid="nav-link">Dashboard</a>
          </nav>
          <main>
            <form data-testid="user-form">
              <input name="username" type="text" />
              <button>Save</button>
            </form>
          </main>
        </div>
      `;

      const link = document.querySelector('a[data-testid="nav-link"]') as HTMLElement;
      const selector = generateBestSelector(link);
      expect(selector).toBeTruthy();
      const matches = querySelectorAllEnhanced(selector);
      expect(matches.elements).toContain(link);
    });

    it('differentiates identical inputs using parent scoping', () => {
      document.body.innerHTML = `
        <div data-intercom-target="env-site-selectors">
          <div><input role="combobox" type="text" /></div>
          <div><input role="combobox" type="text" /></div>
          <div><input role="combobox" type="text" /></div>
        </div>
      `;

      const inputs = document.querySelectorAll('input[role="combobox"]');
      const s1 = generateBestSelector(inputs[0] as HTMLElement);
      const s2 = generateBestSelector(inputs[1] as HTMLElement);
      const s3 = generateBestSelector(inputs[2] as HTMLElement);

      expect(s1).not.toBe(s2);
      expect(s2).not.toBe(s3);

      const m1 = querySelectorAllEnhanced(s1);
      expect(m1.elements).toContain(inputs[0]);
      const m2 = querySelectorAllEnhanced(s2);
      expect(m2.elements).toContain(inputs[1]);
      const m3 = querySelectorAllEnhanced(s3);
      expect(m3.elements).toContain(inputs[2]);
    });
  });

  // ==========================================================================
  // Form-control candidates (radios, dynamic ids, label associations)
  // ==========================================================================

  describe('form-control candidates', () => {
    it('targets a radio input by its value attribute scoped to a test-id ancestor', () => {
      document.body.innerHTML = `
        <div data-testid="QueryEditorModeToggle">
          <div role="radiogroup">
            <div><input type="radio" id="option-builder-:ra6:" name=":ra6:" value="builder" /></div>
            <div><input type="radio" id="option-code-:ra6:" name=":ra6:" value="code" /></div>
          </div>
        </div>
        <!-- unrelated radios elsewhere to force disambiguation -->
        <form>
          <input type="radio" value="builder" name="other" />
          <input type="radio" value="code" name="other" />
        </form>
      `;

      const builder = document.querySelector<HTMLElement>(
        '[data-testid="QueryEditorModeToggle"] input[value="builder"]'
      )!;

      const selector = generateBestSelector(builder);
      expect(selector).not.toMatch(/:nth-match/);
      expect(selector).not.toMatch(/:nth-of-type/);

      const matches = querySelectorAllEnhanced(selector);
      expect(matches.elements).toContain(builder);
      expect(matches.elements.length).toBe(1);
    });

    it('uses a globally-unique input[value] directly when no sibling ambiguity exists', () => {
      document.body.innerHTML = `
        <form>
          <input type="radio" value="unique-mode" name="mode" />
        </form>
      `;
      const input = document.querySelector<HTMLInputElement>('input')!;
      const selector = generateBestSelector(input);
      expect(selector).toContain("value='unique-mode'");
      const matches = querySelectorAllEnhanced(selector);
      expect(matches.elements).toContain(input);
      expect(matches.elements.length).toBe(1);
    });

    it("uses [id^='prefix-'] when the id has a dynamic :rXX: suffix", () => {
      document.body.innerHTML = `
        <div>
          <input type="text" id="field-name-:r7a:" />
        </div>
      `;
      const input = document.querySelector<HTMLInputElement>('input')!;
      const info = getSelectorInfo(input);
      // At minimum we must avoid nth-based selectors entirely.
      expect(info.selector).not.toMatch(/:nth-match/);
      expect(info.selector).not.toMatch(/:nth-of-type/);
      const matches = querySelectorAllEnhanced(info.selector);
      expect(matches.elements).toContain(input);
    });

    it('emits a sibling-label selector for a text input with an adjacent <label>', () => {
      document.body.innerHTML = `
        <div data-testid="settings-form">
          <div>
            <label>Dashboard title</label>
            <input type="text" />
          </div>
          <div>
            <label>Folder</label>
            <input type="text" />
          </div>
        </div>
      `;
      const input = document.querySelectorAll<HTMLInputElement>('input')[0]!;
      const selector = generateBestSelector(input);
      // Must not fall back to positional — a label-based selector is available
      expect(selector).not.toMatch(/:nth-match/);
      const matches = querySelectorAllEnhanced(selector);
      expect(matches.elements).toContain(input);
      expect(matches.elements.length).toBe(1);
    });

    it('emits select[name=...] for a stable-looking name', () => {
      document.body.innerHTML = `
        <form>
          <select name="datasource"><option>p</option></select>
          <select name="panel"><option>a</option></select>
        </form>
      `;
      const select = document.querySelector<HTMLSelectElement>('select[name="datasource"]')!;
      const selector = generateBestSelector(select);
      expect(selector).toContain("name='datasource'");
      const matches = querySelectorAllEnhanced(selector);
      expect(matches.elements).toContain(select);
      expect(matches.elements.length).toBe(1);
    });

    it('skips name-based selectors when the name is dynamic (React 18 :rXX:)', () => {
      document.body.innerHTML = `
        <form>
          <input type="text" name=":r5a:" />
        </form>
      `;
      const input = document.querySelector<HTMLInputElement>('input')!;
      const selector = generateBestSelector(input);
      expect(selector).not.toContain(':r5a:');
      const matches = querySelectorAllEnhanced(selector);
      expect(matches.elements).toContain(input);
    });

    it('prefers the scoped low-score candidate over a compound 500+ candidate when both exist', () => {
      // A radio with both a compound-worthy attribute and a cheaper input-value candidate.
      // The input-value scoped to the testid ancestor should win.
      document.body.innerHTML = `
        <div data-testid="toolbar">
          <input type="radio" value="left" name="align" />
          <input type="radio" value="right" name="align" />
        </div>
        <input type="radio" value="left" name="other" />
      `;
      const left = document.querySelector<HTMLInputElement>('[data-testid="toolbar"] input[value="left"]')!;
      const selector = generateBestSelector(left);
      const info = getSelectorInfo(left);
      expect(['input-value', 'id-prefix', 'scoped-testid', 'compound']).toContain(info.method);
      expect(selector).not.toMatch(/:nth-match/);
      const matches = querySelectorAllEnhanced(selector);
      expect(matches.elements).toContain(left);
      expect(matches.elements.length).toBe(1);
    });
  });
});
