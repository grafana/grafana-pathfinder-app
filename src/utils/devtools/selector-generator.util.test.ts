import { generateSelectorFromEvent } from './selector-generator.util';

describe('generateSelectorFromEvent — fallback chain', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('returns a strategy-diverse fallback chain that excludes the primary selector', () => {
    const button = document.createElement('button');
    button.setAttribute('data-testid', 'save');
    button.setAttribute('aria-label', 'Save document');
    document.body.appendChild(button);

    const result = generateSelectorFromEvent(button, new MouseEvent('click'));

    expect(Array.isArray(result.fallbacks)).toBe(true);
    expect(result.fallbacks.length).toBeGreaterThan(0);
    expect(result.fallbacks).not.toContain(result.selector);
  });

  it('returns an empty fallback chain when the element has only one viable selector', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);

    const result = generateSelectorFromEvent(div, new MouseEvent('click'));

    expect(result.fallbacks).toEqual([]);
  });
});
