import { ButtonHandler } from './button-handler';
import { NavigateHandler } from './navigate-handler';
import { InteractiveStateManager } from '../interactive-state-manager';
import { NavigationManager } from '../navigation-manager';
import { resolveWithRetry } from '../../lib/dom/selector-retry';
import { locationService } from '@grafana/runtime';

jest.mock('../../lib/dom/selector-retry', () => ({ resolveWithRetry: jest.fn() }));
jest.mock('../../lib/dom', () => ({ isElementVisible: () => true }));
jest.mock('../interactive-state-manager');
jest.mock('../navigation-manager');
jest.mock('@grafana/runtime', () => ({ locationService: { push: jest.fn() } }));
jest.mock('../../utils/current-user-role', () => ({ currentUserIsAdmin: () => false }));

beforeEach(() => {
  jest.clearAllMocks();
  document.body.replaceChildren();
});

it('reuses the button handler without teaching delays, scrolling, or completion writes', async () => {
  const button = document.createElement('button');
  button.type = 'button';
  const click = jest.fn();
  button.addEventListener('click', click);
  jest.mocked(resolveWithRetry).mockResolvedValue({
    element: button,
    elements: [button],
    resolvedSelector: '#open',
    usedFallback: false,
    retryCount: 0,
  });
  const state = new InteractiveStateManager();
  const navigation = new NavigationManager();
  const wait = jest.fn();
  const handler = new ButtonHandler(state, navigation, wait);
  expect(await handler.executeRecovery({ targetAction: 'button', refTarget: '#open', tagName: 'button' })).toEqual({
    outcome: 'ok',
  });
  expect(click).toHaveBeenCalledTimes(1);
  expect(wait).not.toHaveBeenCalled();
  expect(navigation.ensureElementVisible).not.toHaveBeenCalled();
  expect(state.setState).not.toHaveBeenCalled();
  expect(resolveWithRetry).toHaveBeenCalledWith(
    '#open',
    'button',
    expect.objectContaining({ delays: [], relaxOnRetry: false })
  );
});

it.each(['submit', 'reset'])('refuses a %s button during recovery', async (type) => {
  const button = document.createElement('button');
  button.setAttribute('type', type);
  const click = jest.fn();
  button.addEventListener('click', click);
  jest.mocked(resolveWithRetry).mockResolvedValue({
    element: button,
    elements: [button],
    resolvedSelector: '#save',
    usedFallback: false,
    retryCount: 0,
  });
  const handler = new ButtonHandler(new InteractiveStateManager(), new NavigationManager(), jest.fn());
  expect(
    await handler.executeRecovery({ targetAction: 'button', refTarget: '#save', tagName: 'button' })
  ).toMatchObject({ outcome: 'error' });
  expect(click).not.toHaveBeenCalled();
});

it('navigates internally without delay or completion, and rejects external or guide-switching routes', async () => {
  const state = new InteractiveStateManager();
  const wait = jest.fn();
  const handler = new NavigateHandler(state, wait);
  const request = { targetAction: 'navigate' as const, refTarget: '/dashboards', tagName: 'button' };
  expect(await handler.executeRecovery(request)).toEqual({ outcome: 'ok' });
  expect(locationService.push).toHaveBeenCalledWith('/dashboards');
  expect(wait).not.toHaveBeenCalled();
  expect(state.setState).not.toHaveBeenCalled();
  for (const refTarget of ['https://example.com', '//example.com', '/dashboards?doc=another-guide']) {
    expect(await handler.executeRecovery({ ...request, refTarget })).toMatchObject({ outcome: 'error' });
  }
  expect(locationService.push).toHaveBeenCalledTimes(1);
});

it('allows an implicit button only outside forms', async () => {
  const button = document.createElement('button');
  button.setAttribute('role', 'menuitem');
  const click = jest.fn();
  button.addEventListener('click', click);
  jest.mocked(resolveWithRetry).mockResolvedValue({
    element: button,
    elements: [button],
    resolvedSelector: '#open',
    usedFallback: false,
    retryCount: 0,
  });
  const handler = new ButtonHandler(new InteractiveStateManager(), new NavigationManager(), jest.fn());
  const request = { targetAction: 'button' as const, refTarget: '#open', tagName: 'button' };
  expect(await handler.executeRecovery(request)).toEqual({ outcome: 'ok' });
  const form = document.createElement('form');
  form.append(button);
  document.body.append(form);
  expect(await handler.executeRecovery(request)).toMatchObject({ outcome: 'error' });
  expect(click).toHaveBeenCalledTimes(1);
});
