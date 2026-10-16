export interface KioskLaunch {
  source: 'url' | 'sidebar';
  rulesUrl?: string;
}

let launch: KioskLaunch | null = null;
const listeners = new Set<() => void>();

export const kioskState = {
  getSnapshot: () => launch,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  set(next: KioskLaunch | null) {
    if (launch?.source === next?.source && launch?.rulesUrl === next?.rulesUrl) {
      return;
    }
    launch = next;
    for (const listener of listeners) {
      listener();
    }
  },
};
