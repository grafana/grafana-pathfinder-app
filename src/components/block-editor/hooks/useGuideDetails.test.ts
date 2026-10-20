import { act, renderHook } from '@testing-library/react';

import { useGuideDetails } from './useGuideDetails';

describe('useGuideDetails', () => {
  it('folds modal changes over earlier ones, leaving omitted fields alone', () => {
    const { result } = renderHook(() => useGuideDetails());

    act(() => result.current.applyDetails({ authorName: 'Dana' }));
    act(() => result.current.applyDetails({ team: 'Docs' }));

    expect(result.current.details).toEqual({ authorName: 'Dana', team: 'Docs' });
  });

  it('keeps an announcement until it is dismissed', () => {
    const { result } = renderHook(() => useGuideDetails());

    act(() => result.current.announceAuthor('Sam Rivera'));
    expect(result.current.authorNotice).toBe('Sam Rivera');

    act(() => result.current.dismissAuthorNotice());
    expect(result.current.authorNotice).toBeNull();
  });

  it('retires the announcement once the author names themselves', () => {
    const { result } = renderHook(() => useGuideDetails());

    act(() => result.current.announceAuthor('Sam Rivera'));
    act(() => result.current.applyDetails({ team: 'Docs' }));
    expect(result.current.authorNotice).toBe('Sam Rivera');

    act(() => result.current.applyDetails({ authorName: 'Dana' }));
    expect(result.current.authorNotice).toBeNull();
  });

  it('forgets everything when a different guide opens', () => {
    const { result } = renderHook(() => useGuideDetails());

    act(() => {
      result.current.applyDetails({ authorName: 'Dana', team: 'Docs' });
      result.current.announceAuthor('Sam Rivera');
    });
    act(() => result.current.resetDetails());

    expect(result.current.details).toEqual({});
    expect(result.current.authorNotice).toBeNull();
  });
});
