import React from 'react';
import { render, screen } from '@testing-library/react';

jest.mock('@grafana/i18n', () => ({
  t: (_key: string, fallback: string, vars?: Record<string, string>) =>
    vars ? fallback.replace(/\{\{(\w+)\}\}/g, (_m, name) => vars[name] ?? '') : fallback,
}));

jest.mock('@grafana/runtime', () => ({
  config: { buildInfo: { version: '13.1.0' } },
}));

import { config } from '@grafana/runtime';
import { testIds } from '../../../constants/testIds';
import { GuideVersionNotice } from './GuideVersionNotice';

function setGrafanaVersion(version: string | undefined) {
  (config as { buildInfo: { version: string | undefined } }).buildInfo.version = version;
}

describe('GuideVersionNotice', () => {
  beforeEach(() => {
    setGrafanaVersion('13.1.0');
  });

  it('warns when the running Grafana is below the declared floor', () => {
    render(<GuideVersionNotice manifest={{ minGrafanaVersion: '13.2.0' }} />);

    expect(screen.getByTestId(testIds.guideVersionNotice.container)).toBeInTheDocument();
    expect(screen.getByText(/Grafana 13\.2\.0 or later/)).toBeInTheDocument();
    expect(screen.getByText(/this instance runs 13\.1\.0/)).toBeInTheDocument();
  });

  it('reports the running version without its Cloud build suffix', () => {
    setGrafanaVersion('13.1.0-77777');

    render(<GuideVersionNotice manifest={{ minGrafanaVersion: '13.2.0' }} />);

    expect(screen.getByText(/this instance runs 13\.1\.0\./)).toBeInTheDocument();
  });

  it('reads a floor parked in additionalFields by the App Platform CRD', () => {
    render(<GuideVersionNotice manifest={{ additionalFields: { minGrafanaVersion: '13.2.0' } }} />);

    expect(screen.getByTestId(testIds.guideVersionNotice.container)).toBeInTheDocument();
  });

  it.each([
    ['no manifest at all — a docs page or legacy journey', undefined],
    ['a manifest declaring no floor', { id: 'g', type: 'guide' }],
    ['a floor the running version meets', { minGrafanaVersion: '13.0.0' }],
    ['an unparseable floor', { minGrafanaVersion: 'latest' }],
  ])('renders nothing for %s', (_label, manifest) => {
    render(<GuideVersionNotice manifest={manifest as Record<string, unknown> | undefined} />);

    expect(screen.queryByTestId(testIds.guideVersionNotice.container)).not.toBeInTheDocument();
  });

  it('renders nothing when the running version is unreadable, rather than warning wrongly', () => {
    setGrafanaVersion(undefined);

    render(<GuideVersionNotice manifest={{ minGrafanaVersion: '13.2.0' }} />);

    expect(screen.queryByTestId(testIds.guideVersionNotice.container)).not.toBeInTheDocument();
  });
});
