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
  analyzeSelectorString,
} from './selector-generator';
import { querySelectorAllEnhanced } from './enhanced-selector';
import { resolveSelector } from './selector-resolver';

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

    it('prefers a testid-scoped bare tag over the name attribute when both are unique', () => {
      document.body.innerHTML = `
        <div data-intercom-target="env-selectors">
          <div data-testid="env-field">
            <input type="text" name="env" />
          </div>
        </div>
      `;
      const input = document.querySelector('input') as HTMLElement;
      const selector = generateBestSelector(input);
      // A stable-testid-scoped bare tag ranks above `name` (same tier as the existing
      // aria-label/button-text-over-name ordering) since it's anchored to a deliberately
      // labeled container rather than an attribute that's often reused across forms.
      expect(selector).toBe("div[data-testid='env-field'] input");
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

    it('rejects a bare tag fallback when no stable ancestor scope exists', () => {
      document.body.innerHTML = `
        <div>
          <button aria-label="Save document">Save</button>
        </div>
      `;
      const button = document.querySelector('button') as HTMLElement;
      const primary = generateBestSelector(button);
      const fallbacks = generateFallbackSelectors(button, primary);
      // The only <button> on the page is globally unique, but "unique by luck" is not
      // admissible — the same rule rankAndSelect applies to the primary selector.
      expect(fallbacks).not.toContain('button');
    });

    it('admits a bare tag fallback only in its stably scoped form', () => {
      document.body.innerHTML = `
        <div data-testid="env-field">
          <input name="env" type="text" />
        </div>
      `;
      const input = document.querySelector('input') as HTMLElement;
      const fallbacks = generateFallbackSelectors(input, "input[name='env']");
      expect(fallbacks).not.toContain('input');
      expect(fallbacks).toContain("div[data-testid='env-field'] input");
    });
  });

  // ==========================================================================
  // grafana e2e-selector awareness
  // ==========================================================================

  describe('grafana e2e-selector awareness', () => {
    it('prefers a version-stable grafana: selector for a known component testid', () => {
      const button = document.createElement('button');
      button.setAttribute('data-testid', 'data-testid RefreshPicker run button');
      document.body.appendChild(button);

      expect(generateBestSelector(button)).toMatch(/^grafana:components\./);
    });

    it('keeps the raw testid selector available as a fallback', () => {
      const button = document.createElement('button');
      button.setAttribute('data-testid', 'data-testid RefreshPicker run button');
      document.body.appendChild(button);

      const primary = generateBestSelector(button);
      const fallbacks = generateFallbackSelectors(button, primary);
      expect(fallbacks.some((s) => s.includes("[data-testid='data-testid RefreshPicker run button']"))).toBe(true);
    });

    it('emits a grafana:pages selector as the best selector for a page-level element', () => {
      const input = document.createElement('input');
      input.setAttribute('data-testid', 'data-testid Username input field');
      document.body.appendChild(input);

      expect(generateBestSelector(input)).toMatch(/^grafana:pages\./);
    });
  });

  // ==========================================================================
  // analyzeSelectorString — single source of truth for the health badge
  // ==========================================================================

  describe('analyzeSelectorString', () => {
    it('rates a data-testid selector as good with a high stability score', () => {
      const analysis = analyzeSelectorString("button[data-testid='save']");
      expect(analysis.method).toBe('data-testid');
      expect(analysis.quality).toBe('good');
      expect(analysis.stabilityScore).toBeGreaterThanOrEqual(80);
    });

    it('rates a bare positional selector as poor and flags it structural', () => {
      const analysis = analyzeSelectorString('button:nth-of-type(3)');
      expect(analysis.quality).toBe('poor');
      expect(analysis.flags).toContain('structural');
    });

    it('flags an aria-label selector as i18n-sensitive', () => {
      const analysis = analyzeSelectorString("button[aria-label='Save document']");
      expect(analysis.flags).toContain('i18n-sensitive');
      expect(analysis.quality).toBe('medium');
    });

    it('treats an ancestor-anchored structural selector as medium (testid scope + nth-child)', () => {
      const analysis = analyzeSelectorString("section[data-testid='card'] > span:nth-child(2)");
      expect(analysis.flags).toContain('structural');
      expect(analysis.quality).toBe('medium');
    });

    it('rates a :has() descendant-anchored selector as medium', () => {
      const analysis = analyzeSelectorString("li > div:has(a[data-testid='nav'][href='/explore'])");
      expect(analysis.method).toBe('has-descendant');
      expect(analysis.quality).toBe('medium');
    });

    it('rates a grafana: reftarget as good with the top stability score', () => {
      const analysis = analyzeSelectorString('grafana:components.RefreshPicker.runButton');
      expect(analysis.method).toBe('grafana');
      expect(analysis.quality).toBe('good');
      expect(analysis.stabilityScore).toBe(100);
    });

    it('rates a panel: reftarget as good with the top stability score', () => {
      const analysis = analyzeSelectorString('panel:CPU Usage');
      expect(analysis.method).toBe('grafana');
      expect(analysis.quality).toBe('good');
      expect(analysis.stabilityScore).toBe(100);
    });

    it('recognizes a tag-attached id selector as an id method', () => {
      const analysis = analyzeSelectorString('button#save');
      expect(analysis.method).toBe('id');
      expect(analysis.quality).toBe('good');
    });

    it('does not mistake a fragment href for an id selector', () => {
      const analysis = analyzeSelectorString("a[href='#section']");
      expect(analysis.method).toBe('href');
    });
  });

  // ==========================================================================
  // Automatic stable-ancestor anchoring
  // ==========================================================================

  describe('ancestor anchoring', () => {
    it('anchors a structureless element on its nearest stable ancestor instead of a global positional selector', () => {
      document.body.innerHTML = `
        <section data-testid="data-source-card">
          <header>Cards</header>
          <div><span>one</span><span>two</span></div>
        </section>
        <span>outside</span>
      `;
      const target = document.querySelectorAll('section[data-testid="data-source-card"] span')[1] as HTMLElement;

      const selector = generateBestSelector(target);

      expect(selector).toContain("data-testid='data-source-card'");
      expect(selector.startsWith('span:nth-of-type')).toBe(false);
      expect(querySelectorAllEnhanced(selector).elements).toContain(target);
    });

    it('does not anchor when the element has a stable intrinsic selector', () => {
      document.body.innerHTML = `<div><button data-testid="save">Save</button></div>`;
      const button = document.querySelector("button[data-testid='save']") as HTMLElement;

      expect(generateBestSelector(button)).toBe("button[data-testid='save']");
    });
  });

  // ==========================================================================
  // has-descendant — stable descendant anchoring via :has()
  // ==========================================================================

  describe('has-descendant selectors', () => {
    it('selects an identity-less wrapper via a stable descendant using :has()', () => {
      document.body.innerHTML = `
        <ul>
          <li><div class="css-a"><div class="css-b"><a data-testid="nav-item" href="/home">Home</a></div></div></li>
          <li><div class="css-c"><div class="css-d"><a data-testid="nav-item" href="/explore">Explore</a></div></div></li>
        </ul>
      `;
      const wrapper = document.querySelectorAll('li')[1]!.querySelector('div') as HTMLElement;

      const selector = generateBestSelector(wrapper);

      expect(selector).toContain(':has(');
      expect(selector).toContain("href='/explore'");
      expect(querySelectorAllEnhanced(selector).elements).toEqual([wrapper]);
    });

    it('prefers an interactive descendant over a decorative one', () => {
      document.body.innerHTML = `
        <ul><li><div class="css-wrap">
          <svg data-testid="icon-x"></svg>
          <a data-testid="link" href="/go">Go</a>
        </div></li></ul>
      `;
      const wrapper = document.querySelector('.css-wrap') as HTMLElement;

      const selector = generateBestSelector(wrapper);

      expect(selector).toContain(':has(');
      expect(selector).toContain("data-testid='link'");
      expect(selector).not.toContain('icon-x');
    });

    it('does not use :has() when the element has its own stable selector', () => {
      document.body.innerHTML = `<div data-testid="card"><a data-testid="x" href="/y">Y</a></div>`;
      const card = document.querySelector("[data-testid='card']") as HTMLElement;

      expect(generateBestSelector(card)).toBe("div[data-testid='card']");
    });

    it('falls back to a positional selector when no stable descendant exists', () => {
      document.body.innerHTML = `<ul><li><div class="css-wrap"><span>plain</span></div></li></ul>`;
      const wrapper = document.querySelector('.css-wrap') as HTMLElement;

      const selector = generateBestSelector(wrapper);

      expect(selector).not.toContain(':has(');
      expect(querySelectorAllEnhanced(selector).elements).toContain(wrapper);
    });

    it('uses the :has() selector as the primary for an identity-less wrapper', () => {
      document.body.innerHTML = `
        <ul>
          <li><div class="css-wrap"><a data-testid="n" href="/a">A</a></div></li>
          <li><div class="css-wrap2"><a data-testid="n" href="/b">B</a></div></li>
        </ul>
      `;
      const wrapper = document.querySelector('.css-wrap') as HTMLElement;

      const primary = generateBestSelector(wrapper);

      expect(primary).toContain(':has(');
      expect(primary).toContain("href='/a'");
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
});

describe('Selector Generator — CSS attribute-value escaping', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('emits a valid, matching selector for a testid containing a single quote', () => {
    const button = document.createElement('button');
    button.setAttribute('data-testid', "Panel menu item Mark's dashboard");
    document.body.appendChild(button);

    const selector = generateBestSelector(button);

    expect(selector).toContain("Mark\\'s");
    const matches = querySelectorAllEnhanced(selector);
    expect(matches.elements).toEqual([button]);
  });

  it('emits a resolvable, matching selector for an aria-label containing a single quote', () => {
    const button = document.createElement('button');
    button.setAttribute('aria-label', "Delete Mark's panel");
    document.body.appendChild(button);

    // The winner may be a grafana: path (the reverse index matches this label
    // against the legacy `${title} panel` template) — resolve like replay does.
    const selector = generateBestSelector(button);
    const resolved = resolveSelector(selector);

    expect(resolved).toContain("\\'");
    const matches = querySelectorAllEnhanced(resolved);
    expect(matches.elements).toEqual([button]);
  });

  it('escapes quote-bearing ancestor testids used as disambiguation scopes', () => {
    document.body.innerHTML = '<div><span></span><span></span></div><section><em></em></section>';
    const scopeParent = document.querySelector('div')!;
    scopeParent.setAttribute('data-testid', "Mark's section");
    const target = scopeParent.querySelector('span')!;

    const selector = generateBestSelector(target as HTMLElement);

    const matches = querySelectorAllEnhanced(selector);
    expect(matches.elements).toEqual([target]);
  });
});
