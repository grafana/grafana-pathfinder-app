import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { ContentRenderer } from './content-renderer';
import { GuideRenderBoundary } from './GuideRenderBoundary';
import { beginGuideLoad, finishGuideLoad } from '../../lib/telemetry/guide-load';
import { recordGuideRender } from '../../lib/telemetry/facade';
import { AlignmentPendingContext } from '../../global-state/alignment-pending-context';
import type { RawContent } from '../../types/content.types';

jest.mock('../../lib/telemetry/facade', () => ({
  ...jest.requireActual('../../lib/telemetry/facade'),
  recordGuideRender: jest.fn(),
}));

function content(blocks: unknown[]): RawContent {
  return {
    content: JSON.stringify({ id: 'private-id', title: 'Private title', blocks }),
    type: 'interactive',
    url: 'backend-guide:private-id',
    lastFetched: '',
    metadata: { title: 'Private title' },
    loadContext: beginGuideLoad('backend-guide:private-id'),
  };
}

beforeEach(() => jest.clearAllMocks());

it('reports a committed render once and calls readiness only after valid content', async () => {
  const raw = content([{ type: 'markdown', content: 'Visible guide text' }]);
  const ready = jest.fn();
  const view = render(<ContentRenderer content={raw} onContentReady={ready} />);
  await screen.findByText('Visible guide text');
  await waitFor(() => expect(ready).toHaveBeenCalledTimes(1));
  view.rerender(<ContentRenderer content={raw} onContentReady={ready} />);
  expect(recordGuideRender).toHaveBeenCalledTimes(1);
  expect(recordGuideRender).toHaveBeenCalledWith(raw.loadContext, 'rendered', expect.any(Number), undefined);
  expect(JSON.stringify((recordGuideRender as jest.Mock).mock.calls)).not.toContain('Private title');
});

it('reports empty output as an error without a false readiness callback', async () => {
  const raw = content([]);
  const ready = jest.fn();
  render(<ContentRenderer content={raw} onContentReady={ready} />);
  await waitFor(() =>
    expect(recordGuideRender).toHaveBeenCalledWith(
      raw.loadContext,
      'error',
      expect.any(Number),
      expect.objectContaining({ stage: 'render', reason: expect.stringMatching(/empty-content|parse-error/) })
    )
  );
  expect(ready).not.toHaveBeenCalled();
});

it('waits for alignment before declaring a render successful', async () => {
  const raw = content([{ type: 'markdown', content: 'Visible guide text' }]);
  const view = render(
    <AlignmentPendingContext.Provider value={{ isPending: true, startingLocation: '/connections' }}>
      <ContentRenderer content={raw} />
    </AlignmentPendingContext.Provider>
  );
  expect(recordGuideRender).not.toHaveBeenCalledWith(raw.loadContext, 'rendered', expect.any(Number), undefined);
  view.rerender(
    <AlignmentPendingContext.Provider value={{ isPending: false, startingLocation: null }}>
      <ContentRenderer content={raw} />
    </AlignmentPendingContext.Provider>
  );
  await waitFor(() =>
    expect(recordGuideRender).toHaveBeenCalledWith(raw.loadContext, 'rendered', expect.any(Number), undefined)
  );
});

it('catches React crashes without sending the error message or guide content', () => {
  const raw = content([]);
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  function Broken(): React.ReactNode {
    throw new Error('private payload');
  }
  try {
    render(
      <GuideRenderBoundary context={raw.loadContext}>
        <Broken />
      </GuideRenderBoundary>
    );
    expect(screen.getByRole('alert')).toHaveTextContent('This guide could not be displayed');
    expect(recordGuideRender).toHaveBeenCalledWith(raw.loadContext, 'error', expect.any(Number), {
      source: 'app-platform',
      stage: 'render',
      reason: 'react-error',
    });
    expect(JSON.stringify((recordGuideRender as jest.Mock).mock.calls)).not.toContain('private payload');
  } finally {
    finishGuideLoad(raw.loadContext, 'cancelled');
    consoleError.mockRestore();
  }
});
