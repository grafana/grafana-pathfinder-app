import { css, keyframes } from '@emotion/css';
import { colorManipulator, type GrafanaTheme2 } from '@grafana/data';

export function showHelpButtonTooltip(
  anchor: HTMLButtonElement,
  theme: GrafanaTheme2,
  labels: { message: string; dismiss: string },
  onDismiss: () => void
): () => void {
  const container = document.createElement('div');
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('width', '18');
  icon.setAttribute('height', '18');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('focusable', 'false');
  icon.style.flexShrink = '0';
  icon.style.color = theme.colors.warning.text;
  const iconPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  iconPath.setAttribute('fill', 'currentColor');
  iconPath.setAttribute(
    'd',
    'M21.49,10.19l-1-.55h0l-9-5-.11,0a1.06,1.06,0,0,0-.19-.06l-.19,0-.18,0a1.17,1.17,0,0,0-.2.06l-.11,0-9,5a1,1,0,0,0,0,1.74L4,12.76V17.5a3,3,0,0,0,3,3h8a3,3,0,0,0,3-3V12.76l2-1.12V14.5a1,1,0,0,0,2,0V11.06A1,1,0,0,0,21.49,10.19ZM16,17.5a1,1,0,0,1-1,1H7a1,1,0,0,1-1-1V13.87l4.51,2.5.15.06.09,0a1,1,0,0,0,.25,0h0a1,1,0,0,0,.25,0l.09,0a.47.47,0,0,0,.15-.06L16,13.87Zm-5-3.14L4.06,10.5,11,6.64l6.94,3.86Z'
  );
  icon.append(iconPath);
  const message = document.createElement('span');
  const close = document.createElement('button');
  const descriptionId = `help-button-hint-${crypto.randomUUID()}`;
  message.id = descriptionId;
  message.textContent = labels.message;
  container.setAttribute('role', 'note');
  container.dataset.testid = 'help-button-learning-hint';
  close.type = 'button';
  close.setAttribute('aria-label', labels.dismiss);
  close.textContent = '\u00d7';
  const pulse = keyframes({
    '0%, 100%': { boxShadow: theme.shadows.z2 },
    '50%': {
      boxShadow: `${theme.shadows.z2}, 0 0 0 1px ${colorManipulator.alpha(theme.colors.warning.main, 0.25)}, 0 0 10px ${colorManipulator.alpha(theme.colors.warning.main, 0.12)}`,
    },
  });
  container.className = css({
    position: 'fixed',
    zIndex: theme.zIndex.tooltip,
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    maxWidth: 'calc(100vw - 24px)',
    padding: theme.spacing(0.5, 0.5, 0.5, 1.5),
    background: theme.colors.background.primary,
    color: theme.colors.text.primary,
    border: `1px solid ${theme.colors.warning.main}`,
    borderRadius: theme.shape.radius.default,
    boxShadow: theme.shadows.z2,
    animation: `${pulse} 4s ease-in-out infinite`,
    '&:hover, &:focus-within': { animation: 'none' },
    '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
    '@media (forced-colors: active)': { animation: 'none' },
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: theme.typography.bodySmall.lineHeight,
    '&::before': {
      content: '""',
      position: 'absolute',
      width: 8,
      height: 8,
      top: -5,
      left: 'var(--help-hint-arrow)',
      transform: 'rotate(45deg)',
      background: theme.colors.background.primary,
      borderTop: `1px solid ${theme.colors.warning.main}`,
      borderLeft: `1px solid ${theme.colors.warning.main}`,
    },
    '& button': {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 28,
      height: 28,
      flexShrink: 0,
      padding: 0,
      border: 0,
      borderRadius: theme.shape.radius.default,
      background: 'transparent',
      color: theme.colors.text.secondary,
      fontSize: 20,
      cursor: 'pointer',
      '&:hover': { background: theme.colors.action.hover, color: theme.colors.text.primary },
      '&:focus-visible': { outline: `2px solid ${theme.colors.primary.main}`, outlineOffset: 1 },
    },
  });
  container.append(icon, message, close);
  document.body.append(container);
  const descriptions = anchor.getAttribute('aria-describedby')?.split(/\s+/).filter(Boolean) ?? [];
  anchor.setAttribute('aria-describedby', [...descriptions, descriptionId].join(' '));
  const position = () => {
    const rect = anchor.getBoundingClientRect();
    const width = container.getBoundingClientRect().width;
    const left = Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 12));
    const top = `${rect.bottom + 8}px`;
    const x = `${left}px`;
    const arrow = `${Math.max(12, Math.min(width - 16, rect.left + rect.width / 2 - left - container.clientLeft - 4))}px`;
    if (container.style.left !== x) {
      container.style.left = x;
    }
    if (container.style.top !== top) {
      container.style.top = top;
    }
    if (container.style.getPropertyValue('--help-hint-arrow') !== arrow) {
      container.style.setProperty('--help-hint-arrow', arrow);
    }
  };
  const dismiss = () => {
    const restoreFocus = document.activeElement === close;
    onDismiss();
    if (restoreFocus && anchor.isConnected) {
      anchor.focus();
    }
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      dismiss();
    }
  };
  close.addEventListener('click', dismiss);
  document.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', position);
  window.addEventListener('scroll', position, true);
  const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(position);
  resize?.observe(anchor);
  resize?.observe(container);
  let frame: number;
  const followAnchor = () => {
    position();
    frame = requestAnimationFrame(followAnchor);
  };
  followAnchor();
  return () => {
    cancelAnimationFrame(frame);
    resize?.disconnect();
    close.removeEventListener('click', dismiss);
    document.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('resize', position);
    window.removeEventListener('scroll', position, true);
    const remaining = anchor
      .getAttribute('aria-describedby')
      ?.split(/\s+/)
      .filter((id) => id !== descriptionId)
      .join(' ');
    if (remaining) {
      anchor.setAttribute('aria-describedby', remaining);
    } else {
      anchor.removeAttribute('aria-describedby');
    }
    container.remove();
  };
}
