import type { GuideDiagnostic, GuideSource, GuideStage } from '../types/guide-diagnostics.types';

const privateReferences = new Map<string, string>();

export function newGuideLoadId(): string {
  return Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(16).padStart(8, '0')).join(
    ''
  );
}

export function opaqueGuideReference(key: string): string {
  let reference = privateReferences.get(key);
  if (!reference) {
    reference = newGuideLoadId();
    privateReferences.set(key, reference);
  }
  return reference;
}

export function guideSource(url: string): GuideSource {
  if (typeof url !== 'string') {
    return 'other';
  }
  if (url.startsWith('backend-guide:') || url.includes('/interactiveguides/')) {
    return 'app-platform';
  }
  if (url.startsWith('bundled:')) {
    return 'bundled';
  }
  try {
    return new URL(url).hostname === 'grafana.com' ? 'docs' : 'cdn';
  } catch {
    return 'other';
  }
}

export function httpStatus(error: unknown): number | undefined {
  const value = error as { status?: unknown; statusCode?: unknown; data?: { statusCode?: unknown } } | null;
  const status = value?.status ?? value?.statusCode ?? value?.data?.statusCode;
  return typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
}

export function diagnoseGuideError(error: unknown, source: GuideSource, stage: GuideStage = 'fetch'): GuideDiagnostic {
  const statusCode = httpStatus(error);
  const name = (error as { name?: unknown } | null)?.name;
  const reason = statusCode
    ? 'http-error'
    : name === 'TimeoutError'
      ? 'timeout'
      : name === 'AbortError'
        ? 'cancelled'
        : name === 'SyntaxError'
          ? 'invalid-json'
          : error instanceof TypeError
            ? 'network-error'
            : 'unexpected-error';
  return {
    source,
    stage: name === 'SyntaxError' && stage === 'fetch' ? 'decode' : stage,
    reason,
    ...(statusCode !== undefined && { statusCode }),
  };
}
