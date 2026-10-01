import { retryChunkImport } from './retry-chunk-import';

const chunkError = () => Object.assign(new Error('Loading chunk 123 failed'), { name: 'ChunkLoadError' });

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it('recovers a failed chunk download without repeating successful work', async () => {
  const load = jest.fn().mockRejectedValueOnce(chunkError()).mockResolvedValue('loaded');
  const result = retryChunkImport(load);
  await jest.advanceTimersByTimeAsync(1000);
  await expect(result).resolves.toBe('loaded');
  expect(load).toHaveBeenCalledTimes(2);
  expect(jest.getTimerCount()).toBe(0);
});

it('retries early when connectivity returns and removes the online listener', async () => {
  const remove = jest.spyOn(window, 'removeEventListener');
  const load = jest.fn().mockRejectedValueOnce(chunkError()).mockResolvedValue('loaded');
  const result = retryChunkImport(load);
  await jest.advanceTimersByTimeAsync(0);
  window.dispatchEvent(new Event('online'));
  await expect(result).resolves.toBe('loaded');
  window.dispatchEvent(new Event('online'));
  await jest.runAllTimersAsync();
  expect(load).toHaveBeenCalledTimes(2);
  expect(remove).toHaveBeenCalledWith('online', expect.any(Function));
  remove.mockRestore();
});

it('reports the final failure after a bounded number of attempts', async () => {
  const error = chunkError();
  const load = jest.fn().mockRejectedValue(error);
  const result = expect(retryChunkImport(load)).rejects.toBe(error);
  await jest.runAllTimersAsync();
  await result;
  expect(load).toHaveBeenCalledTimes(4);
  expect(jest.getTimerCount()).toBe(0);
});

it('does not retry evaluation errors', async () => {
  const error = new TypeError('Module initialization failed');
  const load = jest.fn().mockRejectedValue(error);
  await expect(retryChunkImport(load)).rejects.toBe(error);
  expect(load).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});
