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
