import { act, renderHook, waitFor } from '@testing-library/react';
import { useOrganizationGuide } from './useOrganizationGuide';
import { getConfigWithDefaults } from '../../constants';
import { usePathfinderPluginConfig } from '../../hooks';
import { resolveOrganizationGuide } from '../../integrations/organization-guide/resolve';
import { loadMyCompletions } from '../../completion-records/completion-read-client';
import { getJourneyCompletionPercentageAsync } from '../../docs-retrieval';
import { hasEmittedGuideCompletion, onCompletionRecorded } from '../../completion-records/completion-recorder';

jest.mock('../../hooks', () => ({ usePathfinderPluginConfig: jest.fn() }));
jest.mock('../../lib/platform', () => ({ currentPlatform: () => 'cloud' }));
jest.mock('../../integrations/organization-guide/resolve', () => ({ resolveOrganizationGuide: jest.fn() }));
jest.mock('../../completion-records/completion-read-client', () => ({ loadMyCompletions: jest.fn() }));
jest.mock('../../completion-records/completion-recorder', () => ({
  hasEmittedGuideCompletion: jest.fn(),
  onCompletionRecorded: jest.fn(() => jest.fn()),
}));
jest.mock('../../docs-retrieval', () => ({ getJourneyCompletionPercentageAsync: jest.fn() }));
const settings = (organizationGuideId: string) => ({
  config: getConfigWithDefaults({ organizationGuideId }),
  isResolved: true,
});
const guide = { resourceName: 'welcome', guideId: 'content-id', url: 'backend-guide:welcome' } as never;

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(usePathfinderPluginConfig).mockReturnValue(settings('welcome'));
  jest.mocked(resolveOrganizationGuide).mockResolvedValue(guide);
  jest
    .mocked(loadMyCompletions)
    .mockResolvedValue({ kind: 'ok', data: { capability: { available: true }, completions: [], inProgress: [] } });
  jest.mocked(getJourneyCompletionPercentageAsync).mockResolvedValue(25);
  jest.mocked(hasEmittedGuideCompletion).mockReturnValue(false);
});

it('keeps persistent access with progress even when the completion lookup is unknown', async () => {
  jest.mocked(loadMyCompletions).mockResolvedValue({ kind: 'unavailable' });
  const { result } = renderHook(() => useOrganizationGuide());
  await waitFor(() => expect(result.current?.progress).toBe(25));
  expect(result.current?.completed).toBe(false);
});

it('updates immediately on local completion and removes the entry when cleared', async () => {
  const { result, rerender } = renderHook(() => useOrganizationGuide());
  await waitFor(() => expect(result.current).not.toBeNull());
  act(() => {
    jest
      .mocked(onCompletionRecorded)
      .mock.calls[0]![0]({ guideSource: 'app-platform', guideId: 'content-id' } as never);
  });
  expect(result.current?.completed).toBe(true);
  jest.mocked(usePathfinderPluginConfig).mockReturnValue(settings(''));
  rerender();
  expect(result.current).toBeNull();
});

it('does not restore a cleared selection when its old response arrives late', async () => {
  let finish!: (value: Awaited<ReturnType<typeof resolveOrganizationGuide>>) => void;
  jest.mocked(resolveOrganizationGuide).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const { result, rerender } = renderHook(() => useOrganizationGuide());
  jest.mocked(usePathfinderPluginConfig).mockReturnValue(settings(''));
  rerender();
  await act(async () => finish(guide));
  expect(result.current).toBeNull();
});
