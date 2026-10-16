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
