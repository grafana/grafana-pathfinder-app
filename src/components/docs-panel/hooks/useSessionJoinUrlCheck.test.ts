import { renderHook } from '@testing-library/react';
import { useSessionJoinUrlCheck } from './useSessionJoinUrlCheck';
import { getAppEvents } from '@grafana/runtime';

jest.mock('@grafana/runtime', () => ({
  getAppEvents: jest.fn(),
}));

describe('useSessionJoinUrlCheck', () => {
  const publishMock = jest.fn();
  let originalSearch: string;

  beforeEach(() => {
    publishMock.mockClear();
    (getAppEvents as jest.Mock).mockReturnValue({ publish: publishMock });
    originalSearch = window.location.search;
  });

  afterEach(() => {
    window.history.replaceState({}, '', `${window.location.pathname}${originalSearch}`);
  });

  function setSearch(search: string) {
    window.history.replaceState({}, '', `${window.location.pathname}${search}`);
  }

  it('does nothing when ?session is absent', () => {
    setSearch('');
    const onShow = jest.fn();
    renderHook(() => useSessionJoinUrlCheck({ isLiveSessionsEnabled: true, onShowAttendeeJoin: onShow }));
    expect(onShow).not.toHaveBeenCalled();
    expect(publishMock).not.toHaveBeenCalled();
  });

  it('opens the attendee-join modal when ?session is present and live sessions enabled', () => {
    setSearch('?session=abc123');
    const onShow = jest.fn();
    renderHook(() => useSessionJoinUrlCheck({ isLiveSessionsEnabled: true, onShowAttendeeJoin: onShow }));
    expect(onShow).toHaveBeenCalledTimes(1);
    expect(publishMock).not.toHaveBeenCalled();
  });

  it('publishes a warning when ?session is present but live sessions disabled', () => {
    setSearch('?session=abc123');
    const onShow = jest.fn();
    renderHook(() => useSessionJoinUrlCheck({ isLiveSessionsEnabled: false, onShowAttendeeJoin: onShow }));
    expect(onShow).not.toHaveBeenCalled();
    expect(publishMock).toHaveBeenCalledWith({
      type: 'alert-warning',
      payload: expect.arrayContaining(['Live sessions disabled']),
    });
  });

  it('treats undefined isLiveSessionsEnabled as disabled', () => {
    setSearch('?session=abc123');
    const onShow = jest.fn();
    renderHook(() => useSessionJoinUrlCheck({ isLiveSessionsEnabled: undefined, onShowAttendeeJoin: onShow }));
    expect(onShow).not.toHaveBeenCalled();
    expect(publishMock).toHaveBeenCalled();
  });
});
