import { trace, SpanStatusCode, type Span, type Tracer, type TracerProvider } from '@opentelemetry/api';
import type { Faro } from '@grafana/faro-web-sdk';
import { endSpanWithOutcome, recordSpanEvent, toSpanAttributes } from './otel-tracer';

const mockExport = jest.fn();

jest.mock('@grafana/faro-web-tracing', () => ({
  FaroTraceExporter: jest.fn().mockImplementation(() => ({
    export: (...args: unknown[]) => mockExport(...args),
  })),
}));

function fakeSpan(): Span {
  return {
    setAttribute: jest.fn(),
    setAttributes: jest.fn(),
    setStatus: jest.fn(),
    recordException: jest.fn(),
    end: jest.fn(),
    addEvent: jest.fn(),
    addLink: jest.fn(),
    addLinks: jest.fn(),
    updateName: jest.fn(),
    isRecording: jest.fn(() => true),
    spanContext: jest.fn(),
  } as unknown as Span;
}

function fakeFaro(): Faro {
  return { api: {} } as Faro;
}

class FakeTracerProvider implements TracerProvider {
  startSpanCalls: Array<{ name: string; options: unknown }> = [];
  span = fakeSpan();

  getTracer(): Tracer {
    return {
      startSpan: (name: string, options?: unknown) => {
        this.startSpanCalls.push({ name, options });
        return this.span;
      },
      startActiveSpan: (): never => {
        throw new Error('not exercised by recordSpanEvent');
      },
    };
  }
}

beforeEach(() => {
  mockExport.mockClear();
});

describe('toSpanAttributes', () => {
  it('passes strings, numbers, and booleans through unchanged', () => {
    expect(toSpanAttributes({ a: 'x', b: 2, c: true })).toEqual({ a: 'x', b: 2, c: true });
  });

  it('drops null and undefined values', () => {
    expect(toSpanAttributes({ a: null, b: undefined, c: 'kept' })).toEqual({ c: 'kept' });
  });

  it('JSON-stringifies values OTel attributes cannot represent natively', () => {
    expect(toSpanAttributes({ meta: { nested: 1 } })).toEqual({ meta: JSON.stringify({ nested: 1 }) });
    expect(toSpanAttributes({ tags: ['a', 'b'] })).toEqual({ tags: JSON.stringify(['a', 'b']) });
  });

  it('truncates long stringified values to 500 chars', () => {
    const result = toSpanAttributes({ big: { text: 'x'.repeat(1000) } });
    expect((result.big as string).length).toBe(500);
  });
});

describe('endSpanWithOutcome', () => {
  it('leaves status unset, sets the outcome attribute, and exports for ok', () => {
    const span = fakeSpan();
    endSpanWithOutcome(fakeFaro(), span, true, 'ok');

    expect(span.setAttribute).toHaveBeenCalledWith('pathfinder.outcome', 'ok');
    expect(span.setStatus).not.toHaveBeenCalled();
    expect(span.recordException).not.toHaveBeenCalled();
    expect(span.end).toHaveBeenCalledTimes(1);
    expect(mockExport).toHaveBeenCalledTimes(1);
  });

  it('sets ERROR status and records the exception for error with an Error instance', () => {
    const span = fakeSpan();
    const boom = new Error('boom');
    endSpanWithOutcome(fakeFaro(), span, true, 'error', boom);

    expect(span.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.ERROR, message: 'boom' });
    expect(span.recordException).toHaveBeenCalledWith(boom);
    expect(span.end).toHaveBeenCalledTimes(1);
  });

  it('sets ERROR status without recordException for timeout', () => {
    const span = fakeSpan();
    endSpanWithOutcome(fakeFaro(), span, true, 'timeout');

    expect(span.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.ERROR, message: 'timed out' });
    expect(span.recordException).not.toHaveBeenCalled();
  });

  it('does not export when the span was never recording', () => {
    const span = fakeSpan();
    endSpanWithOutcome(fakeFaro(), span, false, 'ok');

    expect(span.end).toHaveBeenCalledTimes(1);
    expect(mockExport).not.toHaveBeenCalled();
  });
});

describe('recordSpanEvent', () => {
  afterEach(() => {
    trace.disable();
  });

  it('does not throw and does not export when no global TracerProvider is registered', () => {
    expect(() => recordSpanEvent(fakeFaro(), 'pathfinder_click', {})).not.toThrow();
    expect(mockExport).not.toHaveBeenCalled();
  });

  it('starts and immediately ends a root span with the given name and attributes, then exports it', () => {
    const provider = new FakeTracerProvider();
    trace.setGlobalTracerProvider(provider);

    recordSpanEvent(fakeFaro(), 'pathfinder_click', { step: 2 });

    expect(provider.startSpanCalls).toEqual([
      { name: 'pathfinder_click', options: { attributes: { step: 2 }, root: true } },
    ]);
    expect(provider.span.end).toHaveBeenCalledTimes(1);
    expect(mockExport).toHaveBeenCalledTimes(1);
  });
});
