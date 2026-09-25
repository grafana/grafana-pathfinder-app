export const MAX_INPUT_LENGTH = 2048;

export function normalizeHttpOrigin(value: string): string | null {
  if (value.length > MAX_INPUT_LENGTH || /[\s\x00-\x1f\x7f\\]/.test(value) || !/^https?:\/\//i.test(value)) {
    return null;
  }
  try {
    const url = new URL(value);
    if (
      !url.hostname ||
      value
        .slice(value.indexOf('://') + 3)
        .split('/')[0]!
        .includes('@') ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      value.includes('?') ||
      value.includes('#')
    ) {
      return null;
    }
    // Reject paths that URL normalization would otherwise erase.
    const authorityEnd = value.indexOf('/', value.indexOf('://') + 3);
    if (authorityEnd !== -1 && value.slice(authorityEnd) !== '/') {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function isSafeResponseName(value: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value) && !['__proto__', 'prototype', 'constructor'].includes(value);
}

export class KioskFormError extends Error {
  constructor(
    message: string,
    readonly reason: 'validation' | 'storage' = 'validation'
  ) {
    super(message);
    this.name = 'KioskFormError';
  }
}
