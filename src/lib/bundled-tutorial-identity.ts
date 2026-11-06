import tutorials from '../constants/bundled-tutorials.json';

const ids = new Set(tutorials.map(({ id }) => id));

export function isBundledTutorial(id: string): boolean {
  return ids.has(id);
}

export function bundledTutorialContentKey(value: string): string {
  if (value.startsWith('bundled:')) {
    const id = value.slice('bundled:'.length).replace(/\/content\.json$/, '');
    return ids.has(id) ? `bundled:${id}` : value;
  }
  try {
    const url = new URL(value);
    if (url.origin !== 'https://interactive-learning.grafana.net' || url.search || url.hash) {
      return value;
    }
    const match = /^\/packages\/([^/]+)\/(?:content\.json)?$/.exec(url.pathname);
    return match && ids.has(match[1]!) ? `bundled:${match[1]}` : value;
  } catch {
    return value;
  }
}

export function bundledTutorialCompletionSource(source: string, id: string): string {
  return ids.has(id) && (source === 'interactive-tutorials' || source === 'online-cdn') ? 'bundled' : source;
}
