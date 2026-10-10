export const MAX_INPUT_LENGTH = 2048;

export function normalizeHttpUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || value.length > MAX_INPUT_LENGTH || /[\s\x00-\x1f\x7f\\]/.test(trimmed)) {
    return null;
  }
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(trimmed);
  const hasHostPort = /^(?:[^/?#:]+|\[[^\]]+\]):\d+(?:[/?#]|$)/.test(trimmed);
  if (hasScheme && !hasHostPort && !/^https?:\/\//i.test(trimmed)) {
    return null;
  }
  try {
    const candidate = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : trimmed.startsWith('//')
        ? `https:${trimmed}`
        : `https://${trimmed}`;
    const url = new URL(candidate);
    const authority = candidate.slice(candidate.indexOf('://') + 3).split(/[/?#]/)[0]!;
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !url.hostname ||
      !authority ||
      authority.includes('@') ||
      url.username ||
      url.password ||
      (!/^https?:\/\//i.test(trimmed) &&
        !hasHostPort &&
        !url.hostname.includes('.') &&
        !url.hostname.startsWith('[') &&
        url.hostname !== 'localhost') ||
      (!url.hostname.startsWith('[') &&
        !url.hostname
          .split('.')
          .every(
            (label, index, labels) =>
              (index === labels.length - 1 && label === '') || /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(label)
          ))
    ) {
      return null;
    }
    url.hash = '';
    return url.href.length <= MAX_INPUT_LENGTH ? url.href : null;
  } catch {
    return null;
  }
}

export function normalizeHttpOrigin(value: string): string | null {
  const url = normalizeHttpUrl(value);
  return url === null ? null : new URL(url).origin;
}

export function describeHttpInput(value: string, format?: 'http-origin' | 'http-url'): string | undefined {
  if (!format) {
    return undefined;
  }
  const url = normalizeHttpUrl(value);
  if (!url) {
    return undefined;
  }
  const origin = new URL(url).origin;
  return format === 'http-url' ? `Check: ${url} · Allowed origin: ${origin}` : `Allowed origin: ${origin}`;
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
