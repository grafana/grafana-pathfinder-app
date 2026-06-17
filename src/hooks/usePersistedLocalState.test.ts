import { act, renderHook } from '@testing-library/react';

import { usePersistedBoolean, usePersistedLocalState, usePersistedString } from './usePersistedLocalState';

beforeEach(() => {
  localStorage.clear();
});

describe('usePersistedString', () => {
  const KEY = 'test-pls-string';

  it('initializes from defaultValue when storage is empty', () => {
    const { result } = renderHook(() => usePersistedString(KEY, 'fallback'));
    expect(result.current[0]).toBe('fallback');
  });

  it('initializes from localStorage when the key is present', () => {
    localStorage.setItem(KEY, 'stored');
    const { result } = renderHook(() => usePersistedString(KEY));
    expect(result.current[0]).toBe('stored');
  });

  it('writes through to localStorage on update', () => {
    const { result } = renderHook(() => usePersistedString(KEY));

    act(() => {
      result.current[1]('new value');
    });

    expect(result.current[0]).toBe('new value');
    expect(localStorage.getItem(KEY)).toBe('new value');
  });

  it('supports a functional updater', () => {
    const { result } = renderHook(() => usePersistedString(KEY, 'a'));

    act(() => {
      result.current[1]((prev) => prev + 'b');
    });

    expect(result.current[0]).toBe('ab');
    expect(localStorage.getItem(KEY)).toBe('ab');
  });
});

describe('usePersistedBoolean', () => {
  const KEY = 'test-pls-bool';

  it('defaults to false when key is absent', () => {
    const { result } = renderHook(() => usePersistedBoolean(KEY));
    expect(result.current[0]).toBe(false);
  });

  it('respects defaultValue override when key is absent', () => {
    const { result } = renderHook(() => usePersistedBoolean(KEY, true));
    expect(result.current[0]).toBe(true);
  });

  it('parses "true" as true and other strings as false', () => {
    localStorage.setItem(KEY, 'true');
    const { result } = renderHook(() => usePersistedBoolean(KEY));
    expect(result.current[0]).toBe(true);
  });

  it('treats "TRUE" / non-strict values as false (strict equality)', () => {
    localStorage.setItem(KEY, 'TRUE');
    const { result } = renderHook(() => usePersistedBoolean(KEY));
    expect(result.current[0]).toBe(false);
  });

  it('writes "true" / "false" strings on toggle', () => {
    const { result } = renderHook(() => usePersistedBoolean(KEY));

    act(() => result.current[1](true));
    expect(localStorage.getItem(KEY)).toBe('true');

    act(() => result.current[1](false));
    expect(localStorage.getItem(KEY)).toBe('false');
  });
});

describe('usePersistedLocalState (generic)', () => {
  const KEY = 'test-pls-generic';

  it('round-trips an object via JSON', () => {
    const { result } = renderHook(() =>
      usePersistedLocalState<{ count: number }>({
        key: KEY,
        defaultValue: { count: 0 },
        deserialize: (raw) => JSON.parse(raw),
        serialize: JSON.stringify,
      })
    );

    act(() => result.current[1]({ count: 5 }));

    expect(localStorage.getItem(KEY)).toBe('{"count":5}');
    expect(result.current[0]).toEqual({ count: 5 });
  });

  it('returns defaultValue when deserialize throws', () => {
    localStorage.setItem(KEY, 'not json');

    const { result } = renderHook(() =>
      usePersistedLocalState<{ count: number }>({
        key: KEY,
        defaultValue: { count: 99 },
        deserialize: (raw) => JSON.parse(raw),
        serialize: JSON.stringify,
      })
    );

    expect(result.current[0]).toEqual({ count: 99 });
  });

  it('falls back to defaultValue when localStorage.getItem throws on init', () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = jest.fn(() => {
      throw new Error('storage unavailable');
    });
    try {
      const { result } = renderHook(() => usePersistedString(KEY, 'fallback'));
      expect(result.current[0]).toBe('fallback');
    } finally {
      Storage.prototype.getItem = original;
    }
  });

  it('does not throw when localStorage.setItem throws on update', () => {
    const { result } = renderHook(() => usePersistedString(KEY));

    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = jest.fn(() => {
      throw new Error('quota');
    });
    try {
      expect(() =>
        act(() => {
          result.current[1]('x');
        })
      ).not.toThrow();
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});
