import { getPrTestFetchId, withPrTestMarker } from './pr-test-marker';

export interface PrSnapshot {
  owner: string;
  repo: string;
  sha: string;
}

export function snapshotFileUrl(snapshot: PrSnapshot, path: string): string {
  if (!/^[\w.-]+$/.test(snapshot.owner) || !/^[\w.-]+$/.test(snapshot.repo) || !/^[a-f0-9]{40}$/i.test(snapshot.sha)) {
    throw new Error('Invalid PR snapshot');
  }
  if (!path || path.split('/').some((part) => !part || part === '.' || part === '..') || /[\\\x00-\x20]/.test(path)) {
    throw new Error('Invalid repository path');
  }
  return new URL(
    '/' + [snapshot.owner, snapshot.repo, snapshot.sha, ...path.split('/')].map(encodeURIComponent).join('/'),
    'https://raw.githubusercontent.com'
  ).href;
}

export function parseSnapshotUrl(value: string): (PrSnapshot & { path: string }) | undefined {
  try {
    const url = new URL(value);
    if (url.origin !== 'https://raw.githubusercontent.com' || url.username || url.password || url.search) {
      return undefined;
    }
    const [owner, repo, sha, ...parts] = url.pathname.slice(1).split('/').map(decodeURIComponent);
    const snapshot = { owner: owner!, repo: repo!, sha: sha!, path: parts.join('/') };
    return snapshotFileUrl(snapshot, snapshot.path) === url.origin + url.pathname ? snapshot : undefined;
  } catch {
    return undefined;
  }
}

export function prPreviewContext(value: string): (PrSnapshot & { path: string; fetchId: string }) | undefined {
  const snapshot = parseSnapshotUrl(value);
  const fetchId = getPrTestFetchId(value);
  return snapshot && fetchId?.startsWith('kiosk') ? { ...snapshot, fetchId } : undefined;
}

export function mapPreviewContentUrl(value: string, snapshot: PrSnapshot, fetchId: string): string {
  const url = new URL(value);
  if (
    ['https://interactive-learning.grafana.net', 'https://interactive-learning.grafana-dev.net'].includes(url.origin)
  ) {
    const match = url.pathname.match(/^\/(packages|guides)\/(.+)$/);
    if (match) {
      return withPrTestMarker(
        snapshotFileUrl(snapshot, decodeURIComponent(match[2]!)),
        match[1] === 'guides' ? fetchId.replace(/^kiosk(?:legacy)?/, 'kiosklegacy') : fetchId
      );
    }
  }
  return withPrTestMarker(value, fetchId);
}
