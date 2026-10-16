/** Generate an identifier on both HTTPS and plain-HTTP Grafana instances. */
export function createInstanceId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `pf-nested-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
