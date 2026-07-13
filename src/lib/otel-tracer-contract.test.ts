/**
 * Contract tests against the *installed* @opentelemetry/api and
 * @grafana/faro-web-tracing (not mocks).
 *
 * getPathfinderTracer() never calls setGlobalTracerProvider/setGlobalPropagator
 * itself — it only reads whatever global TracerProvider core Grafana (or
 * nothing) has already registered. These tests prove both ends of that
 * contract against the real packages: (1) with nothing registered, spans are
 * inert no-ops, not failures; (2) with a real provider registered globally,
 * spans created via our accessor are actually routed to it; (3) this module
 * never registers anything itself; (4) the real FaroTraceExporter reaches
 * Faro's pushTraces entry point. A future major bump that changes
 * global-registration or export semantics should fail here, not silently in
 * production.
 */
import { trace, type Span, type Tracer, type TracerProvider } from '@opentelemetry/api';
import { FaroTraceExporter } from '@grafana/faro-web-tracing';
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';
import type { Faro } from '@grafana/faro-web-sdk';
import { getPathfinderTracer } from './otel-tracer';

class RecordingTracer implements Tracer {
  spans: Span[] = [];

  startSpan(name: string): Span {
    const span = {
      name,
      ended: false,
      setAttribute: jest.fn(),
      setAttributes: jest.fn(),
      setStatus: jest.fn(),
      recordException: jest.fn(),
      addEvent: jest.fn(),
      addLink: jest.fn(),
      addLinks: jest.fn(),
      updateName: jest.fn(),
      spanContext: () => ({ traceId: '0'.repeat(32), spanId: '0'.repeat(16), traceFlags: 1 }),
      isRecording: () => true,
      end: jest.fn(),
    } as unknown as Span;
    this.spans.push(span);
    return span;
  }

  startActiveSpan(): never {
    throw new Error('not exercised by getPathfinderTracer callers');
  }
}

class RecordingTracerProvider implements TracerProvider {
  tracer = new RecordingTracer();

  getTracer(): Tracer {
    return this.tracer;
  }
}

describe('@opentelemetry/api global-registration contract', () => {
  afterEach(() => {
    trace.disable();
  });

  it('returns a non-recording no-op span when no global TracerProvider is registered', () => {
    const span = getPathfinderTracer().startSpan('pathfinder_contract_noop');
    expect(span.isRecording()).toBe(false);
    expect(() => span.end()).not.toThrow();
  });

  it('routes spans to whatever global TracerProvider core Grafana already registered', () => {
    const provider = new RecordingTracerProvider();
    trace.setGlobalTracerProvider(provider);

    const span = getPathfinderTracer().startSpan('pathfinder_contract_routed');
    expect(span.isRecording()).toBe(true);
    expect(provider.tracer.spans).toHaveLength(1);
    expect((provider.tracer.spans[0] as unknown as { name: string }).name).toBe('pathfinder_contract_routed');
  });

  it('never calls setGlobalTracerProvider itself', () => {
    const spy = jest.spyOn(trace, 'setGlobalTracerProvider');
    getPathfinderTracer();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('FaroTraceExporter contract', () => {
  it('reaches faro.api.pushTraces when exporting a real ended span', () => {
    const pushTraces = jest.fn();
    const fakeFaroApi = { api: { pushTraces } } as unknown as Faro;

    // A real, fully-shaped ReadableSpan - a locally-constructed provider
    // (never registered globally) is the simplest way to produce one.
    const provider = new BasicTracerProvider();
    const span = provider.getTracer('contract-test').startSpan('pathfinder_contract_export');
    span.end();

    const resultCallback = jest.fn();
    new FaroTraceExporter({ api: fakeFaroApi.api }).export([span] as never, resultCallback);

    expect(pushTraces).toHaveBeenCalledTimes(1);
    expect(resultCallback).toHaveBeenCalledTimes(1);
  });
});
