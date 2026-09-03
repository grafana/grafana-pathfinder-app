import type { Page } from '@playwright/test';

import { ensureDocsPanelOpen } from './bootstrap';
import { ensureGuidePanelOpen } from './panel-recovery';

jest.mock('./bootstrap', () => ({
  ensureDocsPanelOpen: jest.fn(),
}));

const ensureDocsPanelOpenMock = ensureDocsPanelOpen as jest.MockedFunction<typeof ensureDocsPanelOpen>;

function page(): Page {
  return {
    evaluate: jest.fn().mockResolvedValue(undefined),
    reload: jest.fn().mockResolvedValue(undefined),
    locator: jest.fn().mockReturnValue({
      waitFor: jest.fn().mockResolvedValue(undefined),
    }),
  } as unknown as Page;
}

beforeEach(() => {
  jest.clearAllMocks();
});

it('does not offer reload recovery for a later shared milestone', async () => {
  const currentPage = page();
  ensureDocsPanelOpenMock.mockRejectedValue(new Error('Panel unavailable'));

  await expect(ensureGuidePanelOpen(currentPage, '{"id":"later"}', false)).rejects.toThrow('Panel unavailable');

  expect(currentPage.reload).not.toHaveBeenCalled();
  expect(ensureDocsPanelOpenMock).toHaveBeenCalledWith(currentPage);
});

it('keeps reload recovery for standalone and first-milestone execution', async () => {
  const currentPage = page();
  ensureDocsPanelOpenMock.mockImplementation(async (_page, options) => {
    await options?.beforeRetry?.();
    return {} as never;
  });

  await ensureGuidePanelOpen(currentPage, '{"id":"first"}', true);

  expect(currentPage.reload).toHaveBeenCalledTimes(1);
  expect(currentPage.evaluate).toHaveBeenCalledTimes(2);
});
