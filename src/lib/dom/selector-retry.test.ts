import { resolveWithRetry } from './selector-retry';
import { resolveSelectorPipeline } from './selector-pipeline';
import { scrollUntilElementFound } from './dom-utils';

jest.mock('./selector-pipeline', () => ({ resolveSelectorPipeline: jest.fn() }));
jest.mock('./dom-utils', () => ({ scrollUntilElementFound: jest.fn() }));

it('uses lazy discovery only when authored and resolves again after scrolling', async () => {
  const element = document.createElement('button');
  jest
    .mocked(resolveSelectorPipeline)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({
      element,
      elements: [element],
      resolvedSelector: '#lazy',
      strategy: 'exact',
      confidence: 1,
      retryCount: 0,
    });
  jest.mocked(scrollUntilElementFound).mockResolvedValue(element);
  const controller = new AbortController();
  const result = await resolveWithRetry('#lazy', 'highlight', {
    lazyRender: true,
    scrollContainer: '#panels',
    signal: controller.signal,
  });
  expect(scrollUntilElementFound).toHaveBeenCalledWith('#lazy', {
    scrollContainerSelector: '#panels',
    signal: controller.signal,
  });
  expect(result?.element).toBe(element);
});
