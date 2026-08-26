/**
 * Best-effort HTTP status from a backendSrv rejection. Grafana's FetchError
 * exposes `status`; other error shapes seen in the wild carry `statusCode` or
 * nest it under `data`.
 */
export function extractFetchErrorStatus(err: unknown): number | undefined {
  const e = err as { status?: number; statusCode?: number; data?: { statusCode?: number } } | undefined;
  return e?.status ?? e?.statusCode ?? e?.data?.statusCode;
}
