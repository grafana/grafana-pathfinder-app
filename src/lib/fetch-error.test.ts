import { classifyRequestFailure } from './fetch-error';

describe('classifyRequestFailure', () => {
  it.each([
    { shape: 'a top-level status', err: { status: 503 }, reason: 'http-503' },
    { shape: 'a top-level statusCode', err: { statusCode: 418 }, reason: 'http-418' },
    { shape: 'a nested data.statusCode', err: { data: { statusCode: 502 } }, reason: 'http-502' },
    { shape: 'status ahead of statusCode', err: { status: 503, statusCode: 404 }, reason: 'http-503' },
    { shape: 'the low bound', err: { status: 100 }, reason: 'http-100' },
    { shape: 'the high bound', err: { status: 599 }, reason: 'http-599' },
    { shape: 'one below the low bound', err: { status: 99 }, reason: 'transport-error' },
    { shape: 'one above the high bound', err: { status: 600 }, reason: 'transport-error' },
    { shape: 'a string status', err: { status: '503' }, reason: 'transport-error' },
    { shape: 'a non-integer status', err: { status: 503.5 }, reason: 'transport-error' },
    { shape: 'no status', err: new Error('network error'), reason: 'transport-error' },
  ])('returns $reason for $shape', ({ err, reason }) => {
    expect(classifyRequestFailure(err)).toBe(reason);
  });
});
