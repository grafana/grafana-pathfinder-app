export function parseKioskName(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(value) ? value.toLowerCase() : undefined;
}

export function getKioskNameFromCatalogUrl(catalogUrl: string | undefined): string {
  if (!catalogUrl) {
    return 'default';
  }
  try {
    const url = new URL(catalogUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return 'custom';
    }
    const segments = url.pathname.split('/').filter(Boolean);
    const filename = segments.at(-1);
    const candidate = filename === 'rules.json' ? segments.at(-2) : filename?.replace(/\.json$/i, '');
    return parseKioskName(candidate) ?? 'custom';
  } catch {
    return 'custom';
  }
}
