import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';

export function showHelpButtonTooltip(
  anchor: HTMLButtonElement,
  theme: GrafanaTheme2,
  labels: { message: string; dismiss: string },
  onDismiss: () => void
): () => void {
  const container = document.createElement('div');
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
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    boxShadow: theme.shadows.z2,
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
      borderTop: `1px solid ${theme.colors.border.medium}`,
      borderLeft: `1px solid ${theme.colors.border.medium}`,
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
  container.append(message, close);
  document.body.append(container);
  const descriptions = anchor.getAttribute('aria-describedby')?.split(/\s+/).filter(Boolean) ?? [];
  anchor.setAttribute('aria-describedby', [...descriptions, descriptionId].join(' '));
  const position = () => {
    const rect = anchor.getBoundingClientRect();
    const width = container.getBoundingClientRect().width;
    const left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12));
    const top = `${rect.bottom + 8}px`;
    const x = `${left}px`;
    const arrow = `${Math.max(12, Math.min(width - 16, rect.left + rect.width / 2 - left - 4))}px`;
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
  position();
  return () => {
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
