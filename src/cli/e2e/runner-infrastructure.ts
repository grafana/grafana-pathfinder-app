import type { E2EErrorCode } from './schemas/e2e-report.schema';

export const AUTHORITATIVE_BROWSER_INFRASTRUCTURE_CODES: ReadonlySet<E2EErrorCode> = new Set([
  'BROWSER_CRASHED',
  'BROWSER_DISCONNECTED',
  'PAGE_CLOSED',
  'CONTEXT_CLOSED',
]);

export function isAuthoritativeBrowserInfrastructureCode(errorCode: E2EErrorCode | undefined): boolean {
  return errorCode !== undefined && AUTHORITATIVE_BROWSER_INFRASTRUCTURE_CODES.has(errorCode);
}
