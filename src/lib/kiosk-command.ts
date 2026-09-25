const STACK_PLACEHOLDER = '{{grafana.stackUrl}}';

export function resolveKioskCommand(command: string, origin: string): string {
  let stack = 'your-stack';
  try {
    const url = new URL(origin);
    const local =
      url.hostname === 'localhost' ||
      url.hostname.endsWith('.localhost') ||
      url.hostname.startsWith('127.') ||
      url.hostname === '[::1]';
    if (
      url.protocol === 'https:' &&
      !local &&
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash &&
      /^[a-zA-Z0-9.:[\]-]+$/.test(url.host)
    ) {
      stack = `'${url.origin}'`;
    }
  } catch {
    // An unavailable instance origin leaves the author-editable placeholder intact.
  }
  return command.split(STACK_PLACEHOLDER).join(stack);
}
