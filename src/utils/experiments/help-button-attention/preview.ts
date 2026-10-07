import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';

export type HelpPreviewVariant = 'control' | 'glow' | 'tooltip';

export function getHelpPreviewVariant(): HelpPreviewVariant | undefined {
  const params = new URLSearchParams(window.location.search);
  const variant = params.get('pathfinderHelpPreview');
  return params.get('featureControl') === 'true' &&
    (variant === 'control' || variant === 'glow' || variant === 'tooltip')
    ? variant
    : undefined;
}

export function showHelpPreviewControls(
  theme: GrafanaTheme2,
  variant: HelpPreviewVariant,
  reset: (variant: HelpPreviewVariant) => void,
  inspect: () => string
): () => void {
  const panel = document.createElement('section');
  panel.setAttribute('aria-label', 'Help experiment preview');
  panel.dataset.testid = 'help-experiment-preview';
  panel.className = css({
    position: 'fixed',
    bottom: 24,
    left: 24,
    zIndex: theme.zIndex.tooltip,
    maxWidth: 'calc(100vw - 48px)',
    padding: theme.spacing(2),
    background: theme.colors.background.primary,
    color: theme.colors.text.primary,
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    boxShadow: theme.shadows.z2,
    '& select, & button': {
      background: theme.colors.background.secondary,
      color: theme.colors.text.primary,
      border: `1px solid ${theme.colors.border.medium}`,
      borderRadius: theme.shape.radius.default,
      padding: theme.spacing(0.5, 1),
      marginRight: theme.spacing(1),
      '&:focus-visible': { outline: `2px solid ${theme.colors.primary.main}` },
    },
  });
  const heading = document.createElement('strong');
  heading.textContent = 'Help experiment preview';
  const notice = document.createElement('p');
  notice.textContent = 'Test mode: experiment telemetry is suppressed.';
  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Preview variant');
  for (const [value, text] of [
    ['control', 'Control'],
    ['glow', 'Glow'],
    ['tooltip', 'Glow and learning hint'],
  ]) {
    const option = document.createElement('option');
    option.value = value!;
    option.textContent = text!;
    select.append(option);
  }
  select.value = variant;
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Reset preview';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const update = () => {
    const next = inspect();
    if (status.textContent !== next) {
      status.textContent = next;
    }
  };
  const apply = () => {
    reset(select.value as HelpPreviewVariant);
    update();
  };
  select.addEventListener('change', apply);
  button.addEventListener('click', apply);
  panel.append(heading, notice, select, button, status);
  document.body.append(panel);
  update();
  const timer = setInterval(update, 500);
  return () => {
    clearInterval(timer);
    select.removeEventListener('change', apply);
    button.removeEventListener('click', apply);
    panel.remove();
  };
}
