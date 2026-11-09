import React from 'react';
import { render } from '@testing-library/react';
import { OrgRole, type AppRootProps } from '@grafana/data';
import { config } from '@grafana/runtime';
import { SceneApp } from '@grafana/scenes';
import { getFeatureFlagValue } from '../../utils/openfeature';
import { homePage } from '../../pages/homePage';
import { docsPage } from '../../pages/docsPage';
import { fullScreenPage } from '../../pages/fullScreenPage';
import { browsePage } from '../../pages/browsePage';
import { learningInsightsPage } from '../../pages/learningInsightsPage';
import App from './App';
import pluginJson from '../../plugin.json';

jest.mock('@grafana/runtime', () => ({ config: { bootData: { user: { orgRole: 'Admin' } } } }));
jest.mock('@grafana/scenes', () => ({
  SceneApp: jest.fn().mockImplementation(() => ({ Component: () => null })),
}));
jest.mock('../../utils/openfeature', () => ({ getFeatureFlagValue: jest.fn() }));
jest.mock('../../pages/homePage', () => ({ homePage: { title: 'Home' } }));
jest.mock('../../pages/docsPage', () => ({ docsPage: { title: 'Docs' } }));
jest.mock('../../pages/fullScreenPage', () => ({ fullScreenPage: { title: 'Full screen' } }));
jest.mock('../../pages/browsePage', () => ({ browsePage: { title: 'Browse' } }));
jest.mock('../../pages/learningInsightsPage', () => ({ learningInsightsPage: { title: 'Learning insights' } }));
jest.mock('../../context-engine', () => ({ onPluginStart: jest.fn() }));
jest.mock('../../lib/faro', () => ({ pauseFaroBeforeReload: jest.fn(), pushFaroError: jest.fn() }));
jest.mock('../OpenFeatureProvider', () => ({
  PathfinderFeatureProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

beforeEach(() => {
  jest.clearAllMocks();
  config.bootData.user.orgRole = OrgRole.Admin;
  jest.mocked(getFeatureFlagValue).mockImplementation((_name, fallback) => fallback);
});

test('does not publish an unconditional Grafana navigation entry outside the rollout gate', () => {
  expect(pluginJson.includes.find((include) => include.name === 'Learning insights')).toMatchObject({
    addToNav: false,
    defaultNav: false,
    role: 'Admin',
  });
});

test('does not register the reporting route by default', () => {
  render(<App {...({} as AppRootProps)} />);
  expect(SceneApp).toHaveBeenCalledWith({ pages: [homePage, docsPage, fullScreenPage, browsePage] });
  expect(getFeatureFlagValue).toHaveBeenCalledWith('pathfinder.learning-insights', false);
});

test('registers the reporting route for an admin on an opted-in stack', () => {
  jest.mocked(getFeatureFlagValue).mockReturnValue(true);
  render(<App {...({} as AppRootProps)} />);
  expect(SceneApp).toHaveBeenCalledWith({
    pages: [homePage, docsPage, fullScreenPage, browsePage, learningInsightsPage],
  });
});

test.each([OrgRole.Viewer, OrgRole.Editor])(
  'does not register reporting navigation for %s even when enabled',
  (role) => {
    config.bootData.user.orgRole = role;
    jest.mocked(getFeatureFlagValue).mockReturnValue(true);
    render(<App {...({} as AppRootProps)} />);
    expect(SceneApp).toHaveBeenCalledWith({ pages: [homePage, docsPage, fullScreenPage, browsePage] });
  }
);
