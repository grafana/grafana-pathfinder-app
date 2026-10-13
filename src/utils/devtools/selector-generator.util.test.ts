import { querySelectorAllEnhanced } from '../../lib/dom';
import { generateSelectorForElement, generateSelectorFromEvent } from './selector-generator.util';

describe('generateSelectorFromEvent', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('keeps the proven selector when cleaning would make it match another element', () => {
    // The validator strips `.profile-avatar` as an Emotion-style hash, which
    // would leave a bare `div` that matches the first card instead (#404).
    document.body.innerHTML =
      '<main><div class="card"></div><div class="profile-avatar"></div><div class="card"></div></main>';
    const target = document.querySelector<HTMLElement>('.profile-avatar')!;

    const result = generateSelectorFromEvent(target, new MouseEvent('click'));

    expect(result.selector).toBe('div.profile-avatar');
    expect(querySelectorAllEnhanced(result.selector).elements).toEqual([target]);
    expect(result.warnings).toContain('Kept "div.profile-avatar": cleaning it to "div" matched a different element.');
  });

  it('keeps a cleaned selector that still matches only the element', () => {
    document.body.innerHTML = '<main><div class="profile-avatar"></div><span class="card"></span></main>';
    const target = document.querySelector<HTMLElement>('.profile-avatar')!;

    const result = generateSelectorFromEvent(target, new MouseEvent('click'));

    expect(result.selector).toBe('div');
    expect(querySelectorAllEnhanced(result.selector).elements).toEqual([target]);
    expect(result.warnings.some((warning) => warning.startsWith('Kept '))).toBe(false);
  });
});

describe('generateSelectorForElement', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('shows the selector a click records', () => {
    document.body.innerHTML =
      '<main><div class="card"></div><div class="profile-avatar"></div><div class="card"></div></main>';
    const target = document.querySelector<HTMLElement>('.profile-avatar')!;

    expect(generateSelectorForElement(target)).toBe(
      generateSelectorFromEvent(target, new MouseEvent('click')).selector
    );
  });
});
