import { context, trace, SpanStatusCode, type Attributes, type Span, type Tracer } from '@opentelemetry/api';
import { FaroTraceExporter } from '@grafana/faro-web-tracing';
import type { Faro } from '@grafana/faro-web-sdk';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-web';
import packageJson from '../../package.json';

const TRACER_NAME = 'grafana-pathfinder';
const TRACER_VERSION = packageJson.version;

// Read-only: this reads whatever global TracerProvider core Grafana already
// registered (or nothing). It never calls trace.setGlobalTracerProvider() —
// that's what caused both prior tracing attempts to collide with core's own
// registration (faro-web-sdk#1818).
export function getPathfinderTracer(): Tracer {
  return trace.getTracer(TRACER_NAME, TRACER_VERSION);
}

const MAX_ATTRIBUTE_STRING_LENGTH = 500;

// OTel span attributes natively accept string | number | boolean - unlike
// Faro's stringifyAttributes(), primitives pass through unchanged. Anything
// else (objects, arrays) gets JSON.stringify'd, since AttributeValue's array
// support requires homogeneous element types callers can't guarantee here.
export function toSpanAttributes(attributes: Record<string, unknown>): Attributes {
  const result: Attributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value === null || value === undefined) {
      continue;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      result[key] = value;
      continue;
    }
    result[key] = JSON.stringify(value).slice(0, MAX_ATTRIBUTE_STRING_LENGTH);
  }
  return result;
}

export type SpanOutcome = 'ok' | 'error' | 'timeout';

// Maps withFaroUserAction's outcome vocabulary onto OTel span status: `ok`
// leaves status UNSET (OTel convention); `error`/`timeout` both report ERROR
// (no native timeout status), distinguished via pathfinder.outcome.
// recordException() only fires for `error` with a real Error instance.
function setOutcomeOnSpan(span: Span, outcome: SpanOutcome, error?: unknown): void {
  span.setAttribute('pathfinder.outcome', outcome);
  if (outcome !== 'ok') {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: outcome === 'timeout' ? 'timed out' : error instanceof Error ? error.message : String(error),
    });
    if (outcome === 'error' && error instanceof Error) {
      span.recordException(error);
    }
  }
}

// Manually pushes a finished span into Pathfinder's own Faro collector via
// the real FaroTraceExporter, without ever registering it as a SpanProcessor
// on any TracerProvider (not possible for a provider we don't own, and not
// needed - export(), the exact code TracingInstrumentation would otherwise
// run automatically, works standalone). Skips export for non-recording spans
// (nothing globally registered) - wasRecording must be captured before
// span.end(), since isRecording() always reports false afterwards.
export function endSpanWithOutcome(
  faro: Faro,
  span: Span,
  wasRecording: boolean,
  outcome: SpanOutcome,
  error?: unknown
): void {
  setOutcomeOnSpan(span, outcome, error);
  span.end();
  if (wasRecording) {
    new FaroTraceExporter({ api: faro.api }).export([span as unknown as ReadableSpan], () => {});
  }
}

// Lets Faro's own getTraceContext()/isOTELInitialized() helpers work, mirroring
// what TracingInstrumentation.initialize() does at the end of its own setup.
// Scoped to Pathfinder's own isolated Faro object - unrelated to the global
// registry, zero registration-conflict risk.
export function registerOtelWithFaro(faro: Faro): void {
  faro.api.initOTEL(trace, context);
}
