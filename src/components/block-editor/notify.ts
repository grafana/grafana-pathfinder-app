// Module boundary prevents a circular import between BlockEditor and its hooks.

import { getAppEvents } from '@grafana/runtime';

export function notify(type: 'success' | 'error' | 'info', title: string, message?: string) {
  const eventType = type === 'success' ? 'alert-success' : type === 'error' ? 'alert-error' : 'alert-info';
  getAppEvents().publish({ type: eventType, payload: [title, ...(message ? [message] : [])] });
}
