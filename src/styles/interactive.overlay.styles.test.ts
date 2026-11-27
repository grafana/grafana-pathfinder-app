import { addGlobalInteractiveStyles } from './interactive.overlay.styles';

function commentBox(attributes: Record<string, string>, className = 'interactive-comment-box'): HTMLElement {
  const box = document.createElement('div');
  box.className = className;
  Object.entries(attributes).forEach(([name, value]) => box.setAttribute(name, value));
  document.body.appendChild(box);
  return box;
}

describe('interactive comment box visibility', () => {
  beforeEach(() => {
    document.getElementById('interactive-global-styles')?.remove();
    document.body.innerHTML = '';
    addGlobalInteractiveStyles();
  });

  it('starts hidden before it is marked ready', () => {
    const box = commentBox({ 'data-position': 'center' });

    expect(getComputedStyle(box).opacity).toBe('0');
  });

  it.each(['right', 'left', 'top', 'bottom', 'center'])('reveals a ready %s box', (position) => {
    const box = commentBox({ 'data-position': position, 'data-ready': 'true' });

    expect(getComputedStyle(box).opacity).toBe('1');
  });

  it.each(['right', 'left', 'top', 'bottom', 'center'])('reveals an instant %s box', (position) => {
    const box = commentBox({ 'data-position': position }, 'interactive-comment-box interactive-comment-box--instant');

    expect(getComputedStyle(box).opacity).toBe('1');
  });
});

describe('guided highlight lifetime', () => {
  beforeEach(() => {
    document.getElementById('interactive-global-styles')?.remove();
    addGlobalInteractiveStyles();
  });

  it.each(['outline', 'dot'])('keeps the guided %s visible without a terminal fade', (kind) => {
    const highlight = document.createElement('div');
    highlight.className = `interactive-highlight-${kind} interactive-highlight-persistent`;
    document.body.appendChild(highlight);
    const style = getComputedStyle(highlight);
    expect(style.animation).not.toContain('fade');
    expect(Number(style.opacity)).toBeGreaterThan(0);
    highlight.remove();
  });
});

function reducedMotionStyle(element: HTMLElement): Map<string, string> {
  const declarations = new Map<string, string>();
  Array.from(document.styleSheets)
    .flatMap((sheet) => Array.from(sheet.cssRules))
    .filter((rule): rule is CSSMediaRule => rule instanceof CSSMediaRule && rule.conditionText.includes('reduce'))
    .flatMap((rule) => Array.from(rule.cssRules) as CSSStyleRule[])
    .filter((rule) => element.matches(rule.selectorText))
    .forEach((rule) =>
      Array.from(rule.style).forEach((name) => declarations.set(name, rule.style.getPropertyValue(name)))
    );
  return declarations;
}

const GUIDED_VARIANTS: Array<[string, string]> = [
  ['normal outline', 'interactive-highlight-outline'],
  ['instant outline', 'interactive-highlight-outline interactive-highlight-outline--instant'],
  ['persistent outline', 'interactive-highlight-outline interactive-highlight-persistent'],
  ['normal dot', 'interactive-highlight-dot'],
  ['persistent dot', 'interactive-highlight-dot interactive-highlight-persistent'],
];
const FULL_RING =
  '100% var(--hl-thickness), var(--hl-thickness) 100%, 100% var(--hl-thickness), var(--hl-thickness) 100%';

describe('guided highlight visibility', () => {
  beforeEach(() => {
    document.getElementById('interactive-global-styles')?.remove();
    document.body.innerHTML = '';
    addGlobalInteractiveStyles();
  });

  function highlight(className: string): HTMLElement {
    const element = document.createElement('div');
    element.className = className;
    document.body.appendChild(element);
    return element;
  }

  it.each([...GUIDED_VARIANTS, ['hover outline', 'interactive-hover-highlight-outline']])(
    'lets pointer events through the %s',
    (_name, className) => {
      expect(getComputedStyle(highlight(className)).pointerEvents).toBe('none');
    }
  );

  it.each(['interactive-highlight-outline', 'interactive-hover-highlight-outline'])(
    'draws %s thicker than 2px',
    (className) => {
      const thickness = getComputedStyle(highlight(className)).getPropertyValue('--hl-thickness');

      expect(parseFloat(thickness)).toBeGreaterThan(2);
    }
  );

  it('glows around the persistent outline', () => {
    const outline = highlight('interactive-highlight-outline interactive-highlight-persistent');

    expect(getComputedStyle(outline).boxShadow).toContain('var(--hl-glow-soft)');
  });

  it('still draws and breathes the normal outline without reduced motion', () => {
    const { animation } = getComputedStyle(highlight('interactive-highlight-outline'));

    expect(animation).toContain('interactive-draw-border');
    expect(animation).toContain('interactive-glow-breathe');
  });

  it.each(GUIDED_VARIANTS)('stops animating the %s under reduced motion', (_name, className) => {
    expect(reducedMotionStyle(highlight(className)).get('animation')).toBe('none');
  });

  it.each(GUIDED_VARIANTS.filter(([name]) => name.includes('outline')))(
    'keeps the %s fully drawn and glowing under reduced motion',
    (_name, className) => {
      const style = reducedMotionStyle(highlight(className));

      expect(style.get('background-size')).toBe(FULL_RING);
      expect(style.get('box-shadow')).toContain('var(--hl-glow-soft)');
    }
  );

  it('stops the hover outline sliding between targets under reduced motion', () => {
    expect(reducedMotionStyle(highlight('interactive-hover-highlight-outline')).get('transition')).toBe('none');
  });
});
