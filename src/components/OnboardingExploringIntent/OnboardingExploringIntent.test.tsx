import React, { useEffect } from 'react';
import { render } from '@testing-library/react';
import { usePluginComponent } from '@grafana/runtime';
import OnboardingExploringIntent from './OnboardingExploringIntent';
import {
  hasSavedExploringIntent,
  getOnboardingIntentContextKey,
  setOnboardingExploringIntent,
} from '../../global-state/onboarding-exploring-intent';

const mockFlag = jest.fn();
jest.mock('../../utils/openfeature', () => ({ getFeatureFlagClient: () => ({ getObjectValue: mockFlag }) }));
jest.mock('../../utils/experiments/auto-open-guide/config', () => ({
  isAutoOpenGuideConfig: (value: { variant: string }) => ['excluded', 'control', 'treatment'].includes(value.variant),
}));
jest.mock('@grafana/runtime', () => ({
  usePluginComponent: jest.fn(),
  config: { namespace: 'stacks-1', bootData: { user: { id: 1, orgId: 2 } } },
}));
function Supplier({ onChange }: { onChange: (value: unknown) => void }) {
  useEffect(() => {
    onChange({ status: 'ready', exploring: true, contextKey: getOnboardingIntentContextKey() });
  }, [onChange]);
  return null;
}
beforeEach(() => {
  jest.clearAllMocks();
  setOnboardingExploringIntent(null);
  mockFlag.mockReturnValue({ variant: 'treatment' });
  (usePluginComponent as jest.Mock).mockReturnValue({ component: Supplier, isLoading: false });
});
it('does not load setupguide when this experiment is excluded', () => {
  mockFlag.mockReturnValue({ variant: 'excluded' });
  render(<OnboardingExploringIntent />);
  expect(usePluginComponent).not.toHaveBeenCalled();
});
it('consumes the official component and clears its state on unmount', () => {
  const { unmount } = render(<OnboardingExploringIntent />);
  expect(usePluginComponent).toHaveBeenCalledWith('grafana-setupguide-app/onboarding-exploring-intent/v1');
  expect(hasSavedExploringIntent()).toBe(true);
  unmount();
  expect(hasSavedExploringIntent()).toBe(false);
});
it('fails closed when setupguide does not provide the contract', () => {
  (usePluginComponent as jest.Mock).mockReturnValue({ component: undefined, isLoading: false });
  render(<OnboardingExploringIntent />);
  expect(hasSavedExploringIntent()).toBe(false);
});
