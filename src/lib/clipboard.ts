// Call synchronously from the click handler, not after an `await`: the
// execCommand fallback only works while the user activation lasts.
export function copyTextToClipboard(text: string): Promise<boolean> {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
  if (typeof clipboard?.writeText !== 'function') {
    return Promise.resolve(copyWithExecCommand(text));
  }
  try {
    return clipboard.writeText(text).then(
      () => true,
      () => false
    );
  } catch {
    return Promise.resolve(copyWithExecCommand(text));
  }
}

function copyWithExecCommand(text: string): boolean {
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- the only copy path when navigator.clipboard is missing (#2076)
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') {
    return false;
  }

  // Mount next to the focused element: Grafana modals trap focus, so a
  // textarea on document.body cannot be selected from inside one.
  const active = document.activeElement;
  const container =
    active instanceof HTMLElement && active !== document.body && active.parentElement
      ? active.parentElement
      : document.body;

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '0';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  container.appendChild(textarea);

  try {
    textarea.select();
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- the only copy path when navigator.clipboard is missing (#2076)
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
    if (active instanceof HTMLElement && active !== document.body) {
      active.focus({ preventScroll: true });
    }
  }
}
