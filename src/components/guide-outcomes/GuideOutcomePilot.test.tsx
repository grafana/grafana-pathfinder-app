import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { config } from '@grafana/runtime';
import { GuideOutcomePilot } from './GuideOutcomePilot';
import { getFeatureFlagValue } from '../../utils/openfeature';
import { listOutcomeResources } from '../../requirements-manager';

jest.mock('../../utils/openfeature', () => ({ getFeatureFlagValue: jest.fn(), useBooleanFlag: jest.fn(() => false) }));
jest.mock('../../lib/hash.util', () => ({ hashString: jest.fn().mockResolvedValue('revision') }));
jest.mock('../../lib/user-storage', () => ({
  createUserStorage: () => ({ getItem: async () => null, setItem: async () => {} }),
}));
jest.mock('../../requirements-manager', () => ({
  listOutcomeResources: jest.fn().mockResolvedValue([]),
  verifyGrafanaOutcome: jest.fn(),
}));
const content = JSON.stringify({
  id: 'first-dashboard-cloud',
  outcomes: [{ id: 'saved', label: 'Saved dashboard', kind: 'dashboard-saved' }],
});

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = jest.fn(() => ({
    measureText: () => ({ width: 0 }),
    font: '',
  })) as unknown as HTMLCanvasElement['getContext'];
});

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(config.bootData.user, { id: 1, orgId: 1 });
});
it('does not load resources or show outcome controls when disabled', () => {
  jest.mocked(getFeatureFlagValue).mockReturnValue(false);
  render(<GuideOutcomePilot guideId="guide" content={content} />);
  expect(screen.queryByText('Verified outcomes')).not.toBeInTheDocument();
  expect(listOutcomeResources).not.toHaveBeenCalled();
});
it('shows verification separately from guide progress when enabled', async () => {
  jest.mocked(getFeatureFlagValue).mockReturnValue(true);
  render(<GuideOutcomePilot guideId="guide" content={content} />);
  await waitFor(() => expect(screen.getByText('Verified outcomes')).toBeInTheDocument());
  expect(screen.getByText('Not checked')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Check outcome' })).toBeDisabled();
});
it('removes the pilot when switching to another guide', async () => {
  jest.mocked(getFeatureFlagValue).mockReturnValue(true);
  const { rerender } = render(<GuideOutcomePilot guideId="guide" content={content} />);
  await waitFor(() => expect(screen.getByText('Verified outcomes')).toBeInTheDocument());
  rerender(<GuideOutcomePilot guideId="other" content='{"id":"other"}' />);
  expect(screen.queryByText('Verified outcomes')).not.toBeInTheDocument();
});
