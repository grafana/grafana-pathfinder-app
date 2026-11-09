import React from 'react';
import { render, screen } from '@testing-library/react';
import { OrgRole } from '@grafana/data';
import { config } from '@grafana/runtime';
import { getFeatureFlagValue } from '../utils/openfeature';
import { LearningInsightsRenderer } from './learningInsightsPage';

jest.mock('@grafana/runtime', () => ({ config: { bootData: { user: { orgRole: 'Admin' } } } }));
jest.mock('@grafana/scenes', () => ({
  SceneObjectBase: class {},
  SceneAppPage: jest.fn(),
}));
jest.mock('../utils/openfeature', () => ({ getFeatureFlagValue: jest.fn() }));
jest.mock('./LearningInsights', () => ({
  __esModule: true,
  default: () => <div>Reporting view loaded</div>,
}));

beforeEach(() => {
  jest.clearAllMocks();
  config.bootData.user.orgRole = OrgRole.Admin;
  jest.mocked(getFeatureFlagValue).mockImplementation((_name, fallback) => fallback);
});

test('blocks a direct reporting render by default before mounting the lazy page', () => {
  render(<LearningInsightsRenderer />);
  expect(screen.getByText('Learning insights is not enabled for this stack')).toBeInTheDocument();
  expect(screen.queryByText('Reporting view loaded')).not.toBeInTheDocument();
  expect(getFeatureFlagValue).toHaveBeenCalledWith('pathfinder.learning-insights', false);
});

test('mounts the reporting view for an opted-in admin', async () => {
  jest.mocked(getFeatureFlagValue).mockReturnValue(true);
  render(<LearningInsightsRenderer />);
  expect(await screen.findByText('Reporting view loaded')).toBeInTheDocument();
});

test.each([OrgRole.Viewer, OrgRole.Editor])('still blocks a %s on an opted-in stack', (role) => {
  config.bootData.user.orgRole = role;
  jest.mocked(getFeatureFlagValue).mockReturnValue(true);
  render(<LearningInsightsRenderer />);
  expect(screen.getByText('Learning insights is for administrators of the current organization')).toBeInTheDocument();
  expect(screen.queryByText('Reporting view loaded')).not.toBeInTheDocument();
});
