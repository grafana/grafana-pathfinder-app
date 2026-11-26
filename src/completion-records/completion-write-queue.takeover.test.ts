import type { CompletionWriteBody, WriteOutcome } from './completion-write-client';
import { createWriteQueue } from './completion-write-queue';
import { createCompletionWriteStorage, LEASE_TTL_MS } from './completion-write-storage';

function heldResponse() {
  let finish!: (outcome: WriteOutcome) => void;
  const response = new Promise<WriteOutcome>((resolve) => {
    finish = resolve;
  });
  return { send: jest.fn(() => response), finish };
}

it('keeps the takeover key and discards a late retry in the tab that reset', async () => {
  const event: CompletionWriteBody = {
    guideSource: 'bundled',
    guideId: 'guide',
    guideTitle: 'Guide',
    guideCategory: 'interactive',
    completionPercent: 100,
    source: 'objectives',
    completedAt: '2026-07-20T00:00:00.000Z',
    platform: 'cloud',
  };
  let clock = Date.parse(event.completedAt);
  const now = () => clock;
  const original = createCompletionWriteStorage('pilot-owner', 'original');
  const successor = createCompletionWriteStorage('pilot-owner', 'successor');
  const firstResponse = heldResponse();
  const secondResponse = heldResponse();
  const first = createWriteQueue({ now, storage: original, send: firstResponse.send });
  const second = createWriteQueue({ now, storage: successor, send: secondResponse.send });

  first.enqueue(event, { id: 'original-key' });
  const firstPass = first.processDue();
  expect(firstResponse.send).toHaveBeenCalledWith(event, 'original-key');
  await second.processDue();
  expect(secondResponse.send).not.toHaveBeenCalled();

  clock += LEASE_TTL_MS + 1;
  const secondPass = second.processDue();
  expect(secondResponse.send).toHaveBeenCalledWith(event, 'original-key');
  second.clear();
  secondResponse.finish({ kind: 'transient' });
  await secondPass;
  expect(original.list()).toEqual([]);

  firstResponse.finish({ kind: 'created' });
  await firstPass;
  expect(original.list()).toEqual([]);
});
