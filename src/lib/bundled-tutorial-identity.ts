import { parseContentFileUrl, stripContentFile } from './guide-content-file';
import tutorials from '../constants/bundled-tutorials.json';

const ids = new Set(tutorials.map(({ id }) => id));

export function isBundledTutorial(id: string): boolean {
  return ids.has(id);
}

export function bundledTutorialContentKey(value: string): string {
  if (value.startsWith('bundled:')) {
    const id = stripContentFile(value.slice('bundled:'.length));
    return ids.has(id) ? `bundled:${id}` : value;
  }
  try {
    const url = new URL(value);
    if (url.origin !== 'https://interactive-learning.grafana.net' || url.search || url.hash) {
      return value;
    }
    const contentFile = parseContentFileUrl(url.pathname);
    const match = /^\/packages\/([^/]+)\/$/.exec(contentFile ? `${contentFile.base}/` : url.pathname);
    return match && ids.has(match[1]!) ? `bundled:${match[1]}` : value;
  } catch {
    return value;
  }
}

export function bundledTutorialCompletionSource(source: string, id: string): string {
  return ids.has(id) && (source === 'interactive-tutorials' || source === 'online-cdn') ? 'bundled' : source;
}

export function legacyOnlineTutorialId(id: string): string | undefined {
  return tutorials.find((tutorial) => tutorial.id === id)?.legacyOnlineId;
}
