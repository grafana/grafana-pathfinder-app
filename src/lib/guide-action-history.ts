import { StorageKeys } from './storage-keys';
import { getUserScope } from './user-scope';

const sessionFallback = new Set<string>();
const listeners = new Set<() => void>();

function storageKey(): string {
  return StorageKeys.GUIDE_ACTION_USED_PREFIX + getUserScope();
}

export function hasUsedGuideAction(): boolean {
  const key = storageKey();
  try {
    return sessionFallback.has(key) || localStorage.getItem(key) === '1';
  } catch {
    return sessionFallback.has(key);
  }
}

export function recordGuideAction(): void {
  if (hasUsedGuideAction()) {
    return;
  }
  const key = storageKey();
  try {
    localStorage.setItem(key, '1');
  } catch {
    sessionFallback.add(key);
  }
  listeners.forEach((listener) => listener());
}

export function subscribeGuideAction(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === storageKey()) {
      listener();
    }
  };
  listeners.add(listener);
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}
