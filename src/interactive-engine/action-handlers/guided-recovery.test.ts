import { GuidedHandler } from './guided-handler';
import { NavigationManager } from '../navigation-manager';
import { InteractiveStateManager } from '../interactive-state-manager';

jest.mock('../../lib/faro', () => ({ withFaroUserAction: (_n: string, _a: unknown, work: () => unknown) => work() }));
jest.mock('../../lib/dom', () => ({
  querySelectorAllEnhanced: (selector: string) => ({
    elements: [...document.querySelectorAll(selector)],
    usedFallback: false,
  }),
  resolveSelector: (selector: string) => selector,
  isElementVisible: () => true,
  describeElement: () => 'button',
}));

const action = { targetAction: 'highlight' as const, refTarget: '#target' };

function setup() {
  const navigation = {
    ensureNavigationOpen: jest.fn(),
    ensureElementVisible: jest.fn(),
    expandParentNavigationSection: jest.fn(),
    highlightWithComment: jest.fn(),
    clearAllHighlights: jest.fn(),
    clearOwnedHighlights: jest.fn(),
    showNoopComment: jest.fn(),
  };
  const handler = new GuidedHandler(
    {} as InteractiveStateManager,
    navigation as unknown as NavigationManager,
    async () => {}
  );
  return { handler, navigation };
}

afterEach(() => {
  document.body.innerHTML = '';
  jest.useRealTimers();
});

it.each([false, true])('rebinds a replaced target even if highlight setup fails: %s', async (failHighlight) => {
  document.body.innerHTML = '<button id="target">Continue</button>';
  const { handler, navigation } = setup();
  navigation.highlightWithComment.mockImplementation(async () => {
    if (navigation.highlightWithComment.mock.calls.length === 1) {
      document.body.innerHTML = '<button id="target">Continue</button>';
      if (failHighlight) {
        throw new Error('Detached target has no dimensions');
      }
    } else {
      document.querySelector<HTMLElement>('#target')!.click();
    }
  });
  expect(await handler.executeGuidedStep(action, 0, 1, 2000)).toBe('completed');
  expect(navigation.highlightWithComment).toHaveBeenCalledTimes(2);
});

it('cancels discovery before a late target can create a ghost interaction', async () => {
  jest.useFakeTimers();
  const { handler, navigation } = setup();
  const pending = handler.executeGuidedStep(action, 0, 1, 3000);
  await jest.advanceTimersByTimeAsync(10);
  handler.cancel();
  document.body.innerHTML = '<button id="target">Continue</button>';
  await jest.advanceTimersByTimeAsync(4000);
  expect(await pending).toBe('cancelled');
  expect(navigation.highlightWithComment).not.toHaveBeenCalled();
});

it('does not let a second start clobber the first run', async () => {
  document.body.innerHTML = '<button id="target">Continue</button>';
  const { handler, navigation } = setup();
  let reached!: () => void;
  const highlighted = new Promise<void>((resolve) => {
    reached = resolve;
  });
  navigation.highlightWithComment.mockImplementation(async () => {
    reached();
  });
  const first = handler.executeGuidedStep(action, 0, 1, 2000);
  await highlighted;
  expect(await handler.executeGuidedStep(action, 0, 1, 2000)).toBe('error');
  document.querySelector<HTMLElement>('#target')!.click();
  expect(await first).toBe('completed');
});
