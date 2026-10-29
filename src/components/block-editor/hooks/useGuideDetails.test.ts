import { act, renderHook } from '@testing-library/react';

import { useGuideDetails } from './useGuideDetails';

const SAM = { name: 'Sam Rivera' };

describe('useGuideDetails', () => {
  it('folds modal changes over earlier ones, leaving omitted fields alone', () => {
    const { result } = renderHook(() => useGuideDetails());

    act(() => result.current.applyDetails({ authorName: 'Dana' }));
    act(() => result.current.applyDetails({ team: 'Docs' }));

    expect(result.current.details).toEqual({ authorName: 'Dana', team: 'Docs' });
  });

  it('drops a cleared name so the save default applies again', () => {
    const { result } = renderHook(() => useGuideDetails());

    act(() => result.current.applyDetails({ authorName: 'Dana', team: 'Docs' }));
    act(() => result.current.applyDetails({ authorName: undefined }));

    expect(result.current.details.authorName).toBeUndefined();
    expect(result.current.details.team).toBe('Docs');
  });

  it('keeps an announcement until it is dismissed', () => {
    const { result } = renderHook(() => useGuideDetails());

    act(() => result.current.announceAuthor(SAM));
    expect(result.current.authorNotice).toEqual(SAM);

    act(() => result.current.dismissAuthorNotice());
    expect(result.current.authorNotice).toBeNull();
  });

  it('retires the announcement once the author names themselves', () => {
    const { result } = renderHook(() => useGuideDetails());

    act(() => result.current.announceAuthor(SAM));
    act(() => result.current.applyDetails({ team: 'Docs' }));
    expect(result.current.authorNotice).toEqual(SAM);

    act(() => result.current.applyDetails({ authorName: 'Dana' }));
    expect(result.current.authorNotice).toBeNull();
  });

  it('forgets everything when a different guide opens', () => {
    const { result } = renderHook(() => useGuideDetails());

    act(() => {
      result.current.applyDetails({ authorName: 'Dana', team: 'Docs' });
      result.current.announceAuthor(SAM);
    });
    act(() => result.current.resetDetails());

    expect(result.current.details).toEqual({});
    expect(result.current.authorNotice).toBeNull();
  });
});
