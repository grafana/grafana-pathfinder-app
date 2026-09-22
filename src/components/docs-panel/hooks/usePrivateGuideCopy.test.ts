import { act, renderHook } from '@testing-library/react';
import type { LearningJourneyTab } from '../../../types/content-panel.types';
import { StorageKeys } from '../../../lib/storage-keys';
import { usePrivateGuideCopy } from './usePrivateGuideCopy';
import { preparePrivateGuideCopy } from '../utils/private-guide-copy';
import { currentUserIsAdmin } from '../../../utils/current-user-role';
import { notify } from '../../block-editor/notify';

jest.mock('../utils/private-guide-copy', () => ({ preparePrivateGuideCopy: jest.fn() }));
jest.mock('../../../utils/current-user-role', () => ({ currentUserIsAdmin: jest.fn(() => true) }));
jest.mock('../../block-editor/notify', () => ({ notify: jest.fn() }));

const guide = { id: 'private-copy', title: 'Copy', blocks: [] };
const url = 'https://grafana.com/guide/content.json';
const tab: LearningJourneyTab = {
  id: 'guide',
  type: 'docs',
  title: 'Guide',
  baseUrl: url,
  currentUrl: url,
  isLoading: false,
  error: null,
  content: {
    content: '{}',
    isNativeJson: true,
    url,
    lastFetched: '',
    type: 'interactive',
    metadata: { title: 'Guide' },
  },
};

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
  jest.mocked(currentUserIsAdmin).mockReturnValue(true);
  jest.mocked(preparePrivateGuideCopy).mockResolvedValue(guide);
});

it('opens a prepared copy without a backend write', async () => {
  const open = jest.fn();
  const { result } = renderHook(() => usePrivateGuideCopy(tab, open));
  await act(() => result.current.prepare());
  expect(open).toHaveBeenCalledTimes(1);
  expect(JSON.parse(localStorage.getItem(StorageKeys.BLOCK_EDITOR_STATE)!).guide).toEqual(guide);
});

it('preserves an existing draft on cancel and replaces it only after confirmation', async () => {
  const original = JSON.stringify({
    guide: { id: 'existing', title: 'Existing', blocks: [] },
    jsonModeState: { json: 'unapplied' },
  });
  localStorage.setItem(StorageKeys.BLOCK_EDITOR_STATE, original);
  const open = jest.fn();
  const { result } = renderHook(() => usePrivateGuideCopy(tab, open));
  await act(() => result.current.prepare());
  expect(result.current.needsConfirmation).toBe(true);
  expect(localStorage.getItem(StorageKeys.BLOCK_EDITOR_STATE)).toBe(original);
  act(() => result.current.cancel());
  expect(open).not.toHaveBeenCalled();
  expect(localStorage.getItem(StorageKeys.BLOCK_EDITOR_STATE)).toBe(original);
  await act(() => result.current.prepare());
  act(() => result.current.confirm());
  expect(open).toHaveBeenCalledTimes(1);
});

it('keeps the existing draft when preparation fails', async () => {
  localStorage.setItem(StorageKeys.BLOCK_EDITOR_STATE, 'existing');
  jest.mocked(preparePrivateGuideCopy).mockRejectedValue(new Error('Snippet unavailable'));
  const open = jest.fn();
  const { result } = renderHook(() => usePrivateGuideCopy(tab, open));
  await act(() => result.current.prepare());
  expect(open).not.toHaveBeenCalled();
  expect(localStorage.getItem(StorageKeys.BLOCK_EDITOR_STATE)).toBe('existing');
  expect(notify).toHaveBeenCalledWith('error', 'Could not copy guide', 'Snippet unavailable');
});

it('ignores an in-flight copy after switching tabs', async () => {
  let resolve!: (value: typeof guide) => void;
  jest.mocked(preparePrivateGuideCopy).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  const open = jest.fn();
  const { result, rerender } = renderHook(({ active }) => usePrivateGuideCopy(active, open), {
    initialProps: { active: tab },
  });
  let preparing!: Promise<void>;
  await act(async () => {
    preparing = result.current.prepare();
  });
  rerender({ active: { ...tab, id: 'another' } });
  await act(async () => {
    resolve(guide);
    await preparing;
  });
  expect(open).not.toHaveBeenCalled();
  expect(localStorage.getItem(StorageKeys.BLOCK_EDITOR_STATE)).toBeNull();
});

it('checks admin access again before committing a confirmed replacement', async () => {
  localStorage.setItem(StorageKeys.BLOCK_EDITOR_STATE, 'existing');
  const open = jest.fn();
  const { result } = renderHook(() => usePrivateGuideCopy(tab, open));
  await act(() => result.current.prepare());
  jest.mocked(currentUserIsAdmin).mockReturnValue(false);
  act(() => result.current.confirm());
  expect(open).not.toHaveBeenCalled();
  expect(localStorage.getItem(StorageKeys.BLOCK_EDITOR_STATE)).toBe('existing');
});

it('prepares customization without changing the draft and confirms replacement after generation', async () => {
  localStorage.setItem(StorageKeys.BLOCK_EDITOR_STATE, 'existing');
  const open = jest.fn();
  const { result } = renderHook(() => usePrivateGuideCopy(tab, open));
  await act(() => result.current.prepare(true));
  expect(result.current.customization).toEqual(guide);
  expect(result.current.needsConfirmation).toBe(false);
  expect(open).not.toHaveBeenCalled();
  const customized = { ...guide, title: 'Customized' };
  act(() => result.current.reviewCopy(customized));
  expect(result.current.needsConfirmation).toBe(true);
  expect(result.current.customization).toBeUndefined();
  expect(localStorage.getItem(StorageKeys.BLOCK_EDITOR_STATE)).toBe('existing');
  act(() => result.current.confirm());
  expect(JSON.parse(localStorage.getItem(StorageKeys.BLOCK_EDITOR_STATE)!).guide).toEqual(customized);
  expect(open).toHaveBeenCalledTimes(1);
});

it('can cancel customization without touching the existing draft', async () => {
  localStorage.setItem(StorageKeys.BLOCK_EDITOR_STATE, 'existing');
  const open = jest.fn();
  const { result } = renderHook(() => usePrivateGuideCopy(tab, open));
  await act(() => result.current.prepare(true));
  act(() => result.current.cancel());
  expect(result.current.customization).toBeUndefined();
  expect(localStorage.getItem(StorageKeys.BLOCK_EDITOR_STATE)).toBe('existing');
  expect(open).not.toHaveBeenCalled();
});
