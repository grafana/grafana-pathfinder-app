export type GuideSource = 'app-platform' | 'bundled' | 'cdn' | 'docs' | 'other';
export type GuideStage = 'resolve' | 'fetch' | 'decode' | 'validate' | 'prepare' | 'render';
export type GuideFailureReason =
  | 'http-error'
  | 'network-error'
  | 'timeout'
  | 'cancelled'
  | 'json-null'
  | 'invalid-json'
  | 'schema-invalid'
  | 'missing-fields'
  | 'namespace-unavailable'
  | 'backend-unavailable'
  | 'invalid-url'
  | 'blocked-url'
  | 'not-found'
  | 'not-published'
  | 'index-unavailable'
  | 'empty-content'
  | 'parse-error'
  | 'snippet-unavailable'
  | 'react-error'
  | 'unexpected-error';

export interface GuideDiagnostic {
  source: GuideSource;
  stage: GuideStage;
  reason: GuideFailureReason;
  statusCode?: number;
  validationCount?: number;
}

export interface GuideLoadContext {
  loadId: string;
  source: GuideSource;
  guideRef: string;
}

export type GuideRequestRole = 'content' | 'manifest' | 'index' | 'content-json' | 'unstyled-html' | 'page';
export type GuideRenderOutcome = 'rendered' | 'error' | 'cancelled' | 'timeout' | 'awaiting-user' | 'degraded';

export interface ProxyDiagnostics {
  stage?: 'identity' | 'configuration' | 'token-exchange' | 'app-platform';
  resource?: 'pathfindersettings' | 'interactiveguides' | 'completionrecords';
  operation?: 'get' | 'list' | 'create';
  outcome: 'ok' | 'error' | 'degraded';
  reason?: string;
  upstreamStatus?: number;
  cache?: 'hit' | 'shared' | 'refresh' | 'stale';
  cacheAgeMs?: number;
  manifestFailures?: Record<string, number>;
  budgetExhausted?: boolean;
}
