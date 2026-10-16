import { FocusHandler } from './focus-handler';
import { ButtonHandler } from './button-handler';
import { FormFillHandler } from './form-fill-handler';
import { HoverHandler } from './hover-handler';
import { InteractiveStateManager } from '../interactive-state-manager';
import { NavigationManager } from '../navigation-manager';
import { resolveWithRetry } from '../../lib/dom/selector-retry';
import type { InteractiveElementData } from '../../types/interactive.types';

jest.mock('../../lib/dom/selector-retry', () => ({ resolveWithRetry: jest.fn() }));
jest.mock('@grafana/runtime', () => ({ config: { buildInfo: { version: '13.0.0' } } }));

const state = { setState: jest.fn(), handleError: jest.fn() } as unknown as InteractiveStateManager;
const navigation = {} as NavigationManager;
const settle = async () => {};

it.each([
  ['highlight', FocusHandler],
  ['button', ButtonHandler],
  ['formfill', FormFillHandler],
  ['hover', HoverHandler],
] as const)('%s reports a missing target instead of success in both modes', async (targetAction, Handler) => {
  jest.clearAllMocks();
  jest.mocked(resolveWithRetry).mockResolvedValue(null);
  const handler = new Handler(state, navigation, settle);
  const data: InteractiveElementData = { targetAction, refTarget: '#missing', tagName: 'button' };
  for (const perform of [false, true]) {
    expect(await handler.execute(data, perform)).toEqual({ outcome: 'error', reason: 'target_missing' });
  }
  expect(state.setState).not.toHaveBeenCalledWith(data, 'completed');
});

it('propagates a caught resolution exception to the caller', async () => {
  jest.mocked(resolveWithRetry).mockRejectedValue(new Error('resolver failed'));
  const handler = new FocusHandler(state, navigation, settle);
  expect(await handler.execute({ targetAction: 'highlight', refTarget: '#x', tagName: 'button' }, true)).toEqual({
    outcome: 'error',
    reason: 'action_failed',
  });
});

it('does not click a target that resolves after cancellation', async () => {
  const controller = new AbortController();
  const button = document.createElement('button');
  const click = jest.spyOn(button, 'click');
  let finish!: (value: any) => void;
  jest.mocked(resolveWithRetry).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const handler = new FocusHandler(state, navigation, settle);
  const pending = handler.execute(
    { targetAction: 'highlight', refTarget: '#late', tagName: 'button', signal: controller.signal },
    true
  );
  controller.abort();
  finish({ element: button, elements: [button] });
  expect(await pending).toEqual({ outcome: 'cancelled' });
  expect(click).not.toHaveBeenCalled();
});
