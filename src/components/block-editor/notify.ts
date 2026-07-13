/**
 * Shared toast-notification helper for the block editor.
 * Extracted so both BlockEditor and its extracted hooks can raise
 * notifications without a circular import between them.
 */

import { getAppEvents } from '@grafana/runtime';

export function notify(type: 'success' | 'error' | 'info', title: string, message?: string) {
  const eventType = type === 'success' ? 'alert-success' : type === 'error' ? 'alert-error' : 'alert-info';
  getAppEvents().publish({ type: eventType, payload: [title, ...(message ? [message] : [])] });
}
