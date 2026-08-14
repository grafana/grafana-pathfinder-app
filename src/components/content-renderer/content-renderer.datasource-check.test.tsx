/**
 * Joins the two halves of the data check.
 *
 * The parser suite asserts an `input` block becomes a `datasource-check-step`
 * element; the component suite renders `DatasourceCheckStep` with props. Neither
 * touches the renderer arm between them, so making that arm return `null` left
 * the whole feature dead with every suite green. This takes guide JSON all the
 * way to the DOM.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';

import type { RawContent } from '../../types/content.types';
import { ContentRenderer } from './content-renderer';

jest.mock('@grafana/i18n', () => ({
  t: (_key: string, fallback: string) => fallback,
}));

jest.mock('@grafana/runtime', () => {
  const actual = jest.requireActual('@grafana/runtime');
  return {
    ...actual,
    getDataSourceSrv: () => ({ getList: () => [{ uid: 'prom-1', name: 'Prometheus', type: 'prometheus' }] }),
  };
});

// Grafana's Combobox sizes options through a <canvas> 2d context that jsdom
// does not provide. Same local stub as ChallengeBlockForm.test.tsx.
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = jest.fn(() => ({
    measureText: () => ({ width: 0 }),
    font: '',
  })) as unknown as HTMLCanvasElement['getContext'];
});

const picker = (overrides: Record<string, unknown>) => ({
  type: 'input',
  id: 'metrics-check',
  inputType: 'datasource',
  variableName: 'metricsDatasource',
  prompt: 'Pick the data source holding your metrics.',
  datasourceFilter: 'prometheus',
  ...overrides,
});

function renderGuide(block: Record<string, unknown>) {
  const content: RawContent = {
    content: JSON.stringify({ id: 'data-check-guide', title: 'Data check guide', blocks: [block] }),
    type: 'single-doc',
    url: 'https://grafana.com/docs/guide',
    lastFetched: '2026-08-14T00:00:00.000Z',
    metadata: { title: 'Data check guide' },
  };
  return render(<ContentRenderer content={content} />);
}

describe('a data check authored in guide JSON', () => {
  it('reaches the DOM as a tracked step when the author asked it to block', () => {
    renderGuide(picker({ dataCheckQuery: 'up', dataCheckBlocking: true }));

    expect(screen.getByTestId('datasource-check-step-metrics-check')).toBeInTheDocument();
    expect(screen.getByTestId('datasource-check-run-metrics-check')).toBeInTheDocument();
  });

  it('carries the authored query and failure message through to the rendered step', () => {
    renderGuide(
      picker({
        dataCheckQuery: 'container_cpu_usage_seconds_total',
        dataCheckBlocking: true,
        dataCheckFailureMessage: 'No container CPU metrics here.',
        skippable: true,
      })
    );

    expect(screen.getByTestId('datasource-check-skip-metrics-check')).toBeInTheDocument();
    expect(screen.getByText('Pick the data source holding your metrics.')).toBeInTheDocument();
  });

  it('reaches the DOM as a passive picker when the check is advisory', () => {
    renderGuide(picker({ dataCheckQuery: 'up' }));

    expect(screen.queryByTestId('datasource-check-step-metrics-check')).not.toBeInTheDocument();
    expect(screen.getByTestId('input-data-check-run-metricsDatasource')).toBeInTheDocument();
  });

  it('offers no check at all when the author configured none', () => {
    renderGuide(picker({}));

    expect(screen.queryByTestId('datasource-check-step-metrics-check')).not.toBeInTheDocument();
    expect(screen.queryByTestId('input-data-check-run-metricsDatasource')).not.toBeInTheDocument();
  });
});
