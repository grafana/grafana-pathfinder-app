jest.mock('../../interactive-engine', () =>
  jest.requireActual('../../interactive-engine/auto-completion/passive-action')
);
import { createPassiveObserver } from './passive-observer';
import type { ObservationSubscriptionMessage } from '../../types/cross-tab.types';

jest.mock('../../lib/dom', () => ({
  querySelectorAllEnhanced: (selector: string) => ({ elements: [...document.querySelectorAll(selector)] }),
  findButtonByText: () => [],
}));
jest.mock('../../lib/dom/selector-resolver', () => ({ resolveSelector: (selector: string) => selector }));
const message = (overrides: Partial<ObservationSubscriptionMessage> = {}): ObservationSubscriptionMessage => ({
  source: 'pathfinder',
  senderId: 'controller',
  timestamp: 1,
  kind: 'observation-subscribe',
  generation: 1,
  subscriptionId: 'generation-1',
  guideKey: 'guide',
  revision: 1,
  steps: [
    {
      id: 'step',
      cursor: 0,
      actions: [
        { targetAction: 'button', refTarget: '#next' },
        { targetAction: 'button', refTarget: '#next' },
      ],
    },
  ],
  ...overrides,
});

beforeEach(() => {
  jest.useFakeTimers();
  document.body.innerHTML = '<button id="next">Next</button>';
});
afterEach(() => {
  jest.useRealTimers();
  document.body.replaceChildren();
});

it('sends only scoped evidence and advances synchronously through repeated actions', () => {
  const post = jest.fn();
  const observer = createPassiveObserver(post);
  observer.update(message());
  document.querySelector('button')!.click();
  document.querySelector('button')!.click();
  expect(post.mock.calls.map(([evidence]) => evidence.index)).toEqual([0, 1]);
  expect(post.mock.calls[0]![0]).toEqual({
    kind: 'observation-evidence',
    subscriptionId: 'generation-1',
    guideKey: 'guide',
    id: 'step',
    index: 0,
  });
  observer.stop();
});

it('ignores delayed subscription updates and cannot resurrect a cancelled generation', () => {
  const post = jest.fn();
  const observer = createPassiveObserver(post);
  observer.update(message({ revision: 3 }));
  document.querySelector('button')!.click();
  observer.update(message({ revision: 2 }));
  document.querySelector('button')!.click();
  expect(post.mock.calls.map(([evidence]) => evidence.index)).toEqual([0, 1]);
  observer.cancel('generation-1');
  observer.update(message({ revision: 4 }));
  document.querySelector('button')!.click();
  expect(post).toHaveBeenCalledTimes(2);
  observer.stop();
});

it('expires listeners on disconnect and restores a supplied cursor on reconnect', () => {
  const post = jest.fn();
  const observer = createPassiveObserver(post);
  observer.update(message());
  jest.advanceTimersByTime(6001);
  document.querySelector('button')!.click();
  expect(post).not.toHaveBeenCalled();
  const reconnect = message({ subscriptionId: 'generation-2', generation: 2 });
  reconnect.steps[0]!.cursor = 1;
  observer.update(reconnect);
  document.querySelector('button')!.click();
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ subscriptionId: 'generation-2', index: 1 }));
  observer.stop();
});

it('rejects an older generation whose signature arrives after the replacement', () => {
  const post = jest.fn();
  const observer = createPassiveObserver(post);
  observer.update(message({ subscriptionId: 'new', generation: 2 }));
  observer.update(message({ subscriptionId: 'old', generation: 1 }));
  document.querySelector('button')!.click();
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ subscriptionId: 'new', index: 0 }));
  observer.stop();
});
