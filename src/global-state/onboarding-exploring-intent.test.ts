import { config } from '@grafana/runtime';
import {
  getOnboardingIntentContextKey,
  hasSavedExploringIntent,
  setOnboardingExploringIntent,
  subscribeToOnboardingExploringIntent,
} from './onboarding-exploring-intent';

jest.mock('@grafana/runtime', () => ({ config: { namespace: 'stacks-1', bootData: { user: { id: 1, orgId: 2 } } } }));

beforeEach(() => setOnboardingExploringIntent(null));
it('accepts only a ready saved answer for the current identity', () => {
  const contextKey = getOnboardingIntentContextKey();
  setOnboardingExploringIntent({ status: 'ready', exploring: true, contextKey });
  expect(hasSavedExploringIntent()).toBe(true);
  config.bootData.user.orgId = 3;
  expect(hasSavedExploringIntent()).toBe(false);
  config.bootData.user.orgId = 2;
});
it.each([null, {}, [], 'ready', { status: 'unknown', exploring: true }, { status: 'ready', exploring: 'true' }])(
  'rejects malformed snapshot %s',
  (snapshot) => {
    setOnboardingExploringIntent(snapshot);
    expect(hasSavedExploringIntent()).toBe(false);
  }
);
it('unsubscribes listeners', () => {
  const listener = jest.fn();
  const unsubscribe = subscribeToOnboardingExploringIntent(listener);
  setOnboardingExploringIntent(null);
  unsubscribe();
  setOnboardingExploringIntent(null);
  expect(listener).toHaveBeenCalledTimes(1);
});
