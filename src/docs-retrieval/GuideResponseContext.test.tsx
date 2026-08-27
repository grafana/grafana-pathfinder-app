/**
 * The provider stays mounted while the panel swaps guides, so what it does with
 * the map it already holds is the whole of the behaviour here.
 */

import React from 'react';
import { act, render, screen } from '@testing-library/react';

import { GuideResponseProvider, useGuideResponses } from './GuideResponseContext';

const mockGetForGuide = jest.fn();
const mockSetResponse = jest.fn();

jest.mock('../lib/user-storage', () => ({
  guideResponseStorage: {
    getForGuide: (...args: unknown[]) => mockGetForGuide(...args),
    setResponse: (...args: unknown[]) => mockSetResponse(...args),
    deleteResponse: jest.fn(),
    clearForGuide: jest.fn(),
  },
}));

function Probe() {
  const { responses, setResponse } = useGuideResponses();
  return (
    <div>
      <span data-testid="responses">{JSON.stringify(responses)}</span>
      <button onClick={() => setResponse('ds', 'written-during-load')}>write</button>
    </div>
  );
}

const responses = () => JSON.parse(screen.getByTestId('responses').textContent ?? '{}');

beforeEach(() => {
  mockGetForGuide.mockReset();
  mockSetResponse.mockReset();
});

describe('GuideResponseProvider', () => {
  it("does not carry one guide's responses into the next", async () => {
    mockGetForGuide.mockImplementation((guideId: string) =>
      Promise.resolve(guideId === 'guide-a' ? { ds: 'prom-a', extra: 'only-in-a' } : { ds: 'prom-b' })
    );

    const { rerender } = render(
      <GuideResponseProvider guideId="guide-a">
        <Probe />
      </GuideResponseProvider>
    );
    await act(async () => {});
    expect(responses()).toEqual({ ds: 'prom-a', extra: 'only-in-a' });

    rerender(
      <GuideResponseProvider guideId="guide-b">
        <Probe />
      </GuideResponseProvider>
    );
    await act(async () => {});

    expect(responses()).toEqual({ ds: 'prom-b' });
  });

  it('keeps a response written while the load was in flight', async () => {
    let resolveStorage: (value: Record<string, string>) => void = () => {};
    mockGetForGuide.mockReturnValue(
      new Promise<Record<string, string>>((resolve) => {
        resolveStorage = resolve;
      })
    );

    render(
      <GuideResponseProvider guideId="guide-a">
        <Probe />
      </GuideResponseProvider>
    );

    await act(async () => {
      screen.getByText('write').click();
    });
    await act(async () => {
      resolveStorage({ ds: 'stale-from-storage', other: 'kept' });
    });

    expect(responses()).toEqual({ ds: 'written-during-load', other: 'kept' });
  });
});
