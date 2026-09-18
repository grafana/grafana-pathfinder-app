import React from 'react';
import { render, screen } from '@testing-library/react';

jest.mock('@grafana/i18n', () => ({
  t: (_key: string, fallback: string, vars?: Record<string, string>) =>
    vars ? fallback.replace(/\{\{(\w+)\}\}/g, (_m, name) => vars[name] ?? '') : fallback,
}));

jest.mock('@grafana/runtime', () => ({
  config: { buildInfo: { version: '13.1.0' } },
}));

jest.mock('../../../lib/analytics', () => ({
  reportAppInteraction: jest.fn(),
  UserInteraction: { GuideVersionUnsupportedShown: 'guide_version_unsupported_shown' },
}));

import { config } from '@grafana/runtime';
import { reportAppInteraction, UserInteraction } from '../../../lib/analytics';
import { testIds } from '../../../constants/testIds';
import { GuideVersionNotice, resetGuideVersionImpressions } from './GuideVersionNotice';

function setGrafanaVersion(version: string | undefined) {
  (config as { buildInfo: { version: string | undefined } }).buildInfo.version = version;
}

describe('GuideVersionNotice', () => {
  beforeEach(() => {
    setGrafanaVersion('13.1.0');
    resetGuideVersionImpressions();
    jest.mocked(reportAppInteraction).mockClear();
  });

  it('warns when the running Grafana is below the declared floor', () => {
    render(<GuideVersionNotice manifests={{ minGrafanaVersion: '13.2.0' }} />);

    expect(screen.getByTestId(testIds.guideVersionNotice.container)).toBeInTheDocument();
    expect(screen.getByText(/Grafana 13\.2\.0 or later/)).toBeInTheDocument();
    expect(screen.getByText(/this instance runs 13\.1\.0/)).toBeInTheDocument();
  });

  it('reports the running version without its Cloud build suffix', () => {
    setGrafanaVersion('13.1.0-77777');

    render(<GuideVersionNotice manifests={{ minGrafanaVersion: '13.2.0' }} />);

    expect(screen.getByText(/this instance runs 13\.1\.0\./)).toBeInTheDocument();
  });

  it('reads a floor parked in additionalFields by the App Platform CRD', () => {
    render(<GuideVersionNotice manifests={{ additionalFields: { minGrafanaVersion: '13.2.0' } }} />);

    expect(screen.getByTestId(testIds.guideVersionNotice.container)).toBeInTheDocument();
  });

  it('warns on a floor only the fetched manifest carries, past a slim catalogue one', () => {
    render(<GuideVersionNotice manifests={[{ id: 'g', type: 'guide' }, { minGrafanaVersion: '13.2.0' }]} />);

    expect(screen.getByTestId(testIds.guideVersionNotice.container)).toBeInTheDocument();
    expect(screen.getByText(/Grafana 13\.2\.0 or later/)).toBeInTheDocument();
  });

  it('lets the more authoritative manifest win when both declare a floor', () => {
    render(<GuideVersionNotice manifests={[{ minGrafanaVersion: '13.2.0' }, { minGrafanaVersion: '14.0.0' }]} />);

    expect(screen.getByText(/Grafana 13\.2\.0 or later/)).toBeInTheDocument();
  });

  it.each([
    ['no manifest at all — a docs page or legacy journey', undefined],
    ['a manifest declaring no floor', { id: 'g', type: 'guide' }],
    ['a floor the running version meets', { minGrafanaVersion: '13.0.0' }],
    ['an unparseable floor', { minGrafanaVersion: 'latest' }],
  ])('renders nothing for %s', (_label, manifest) => {
    render(<GuideVersionNotice manifests={manifest as Record<string, unknown> | undefined} />);

    expect(screen.queryByTestId(testIds.guideVersionNotice.container)).not.toBeInTheDocument();
  });

  it('renders nothing when the running version is unreadable, rather than warning wrongly', () => {
    setGrafanaVersion(undefined);

    render(<GuideVersionNotice manifests={{ minGrafanaVersion: '13.2.0' }} />);

    expect(screen.queryByTestId(testIds.guideVersionNotice.container)).not.toBeInTheDocument();
  });

  describe('impression event', () => {
    const warn = { minGrafanaVersion: '13.2.0' };

    it('emits once with both versions when the notice renders', () => {
      render(<GuideVersionNotice manifests={warn} guideUrl="bundled:first-dashboard" guideTitle="First dashboard" />);

      expect(reportAppInteraction).toHaveBeenCalledTimes(1);
      expect(reportAppInteraction).toHaveBeenCalledWith(UserInteraction.GuideVersionUnsupportedShown, {
        guide_url: 'bundled:first-dashboard',
        guide_title: 'First dashboard',
        required_version: '13.2.0',
        grafana_version: '13.1.0',
      });
    });

    it('does not emit a second time when the notice remounts — tab switch, surface handoff', () => {
      const props = { manifests: warn, guideUrl: 'bundled:first-dashboard', guideTitle: 'First dashboard' };
      render(<GuideVersionNotice {...props} />).unmount();
      render(<GuideVersionNotice {...props} />);

      expect(reportAppInteraction).toHaveBeenCalledTimes(1);
    });

    it('emits again for a different guide', () => {
      render(<GuideVersionNotice manifests={warn} guideUrl="bundled:one" />);
      render(<GuideVersionNotice manifests={warn} guideUrl="bundled:two" />);

      expect(reportAppInteraction).toHaveBeenCalledTimes(2);
    });

    it.each([
      ['a guide that meets its floor', { minGrafanaVersion: '13.0.0' }],
      ['a guide with no floor', { id: 'g', type: 'guide' }],
      ['no manifest at all', undefined],
    ])('emits nothing for %s — the reader saw no warning', (_label, manifests) => {
      render(
        <GuideVersionNotice
          manifests={manifests as Record<string, unknown> | undefined}
          guideUrl="bundled:first-dashboard"
        />
      );

      expect(reportAppInteraction).not.toHaveBeenCalled();
    });

    it('emits nothing when the running version is unreadable', () => {
      setGrafanaVersion(undefined);

      render(<GuideVersionNotice manifests={warn} guideUrl="bundled:first-dashboard" />);

      expect(reportAppInteraction).not.toHaveBeenCalled();
    });
  });
});
