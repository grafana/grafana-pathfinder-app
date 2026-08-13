/**
 * Tests for DataCheckOrchestrator, with the assistant hook stubbed.
 *
 * The orchestrator outlives the step that asked for a check, so the lifecycle
 * these cover is the one that matters: whatever the guide does next, the work
 * the check started has to stop with it.
 */

import React from 'react';
import { act, render, waitFor } from '@testing-library/react';

import DataCheckOrchestrator from './DataCheckOrchestrator';
import {
  DATA_CHECK_RESULT_EVENT,
  dispatchDataCheckRequest,
  type DataCheckResultDetail,
} from '../../integrations/assistant-integration/data-check-event';

const mockReset = jest.fn();
let mockAssistantAvailable = true;
let mockCapturedInputs: Array<{ signal?: AbortSignal }> = [];
let mockSettleGenerate: (() => void) | null = null;

jest.mock('../../integrations/assistant-integration/useDataCheckGeneration.hook', () => ({
  useDataCheckGeneration: () => ({
    isAssistantAvailable: mockAssistantAvailable,
    generate: (input: { signal?: AbortSignal }) => {
      mockCapturedInputs.push(input);
      return new Promise<void>((resolve) => {
        mockSettleGenerate = resolve;
      });
    },
    verdict: null,
    error: null,
    reset: mockReset,
  }),
}));

const request = {
  requestId: 'req-1',
  datasourceUid: 'prom-1',
  datasourceType: 'prometheus' as const,
  aiPrompt: 'has container metrics',
};

async function startCheck() {
  await act(async () => {
    dispatchDataCheckRequest(request);
  });
  await waitFor(() => expect(mockCapturedInputs).toHaveLength(1));
  const signal = mockCapturedInputs[0]?.signal as AbortSignal;
  expect(signal.aborted).toBe(false);
  return signal;
}

let results: DataCheckResultDetail[] = [];
const collectResult = (e: Event) => results.push((e as CustomEvent<DataCheckResultDetail>).detail);

beforeAll(() => window.addEventListener(DATA_CHECK_RESULT_EVENT, collectResult));
afterAll(() => window.removeEventListener(DATA_CHECK_RESULT_EVENT, collectResult));

beforeEach(() => {
  mockReset.mockReset();
  mockAssistantAvailable = true;
  mockCapturedInputs = [];
  mockSettleGenerate = null;
  results = [];
});

describe('DataCheckOrchestrator', () => {
  it('aborts an in-flight check when it unmounts', async () => {
    const { unmount } = render(<DataCheckOrchestrator contentKey="tab-1" />);
    const signal = await startCheck();

    unmount();

    expect(signal.aborted).toBe(true);
  });

  it('aborts an in-flight check when the panel swaps guides', async () => {
    const { rerender } = render(<DataCheckOrchestrator contentKey="tab-1" />);
    const signal = await startCheck();

    rerender(<DataCheckOrchestrator contentKey="tab-2" />);

    expect(signal.aborted).toBe(true);
  });

  it('ignores a result that arrives after it unmounts', async () => {
    const { unmount } = render(<DataCheckOrchestrator contentKey="tab-1" />);
    await startCheck();

    unmount();
    await act(async () => {
      mockSettleGenerate?.();
    });

    expect(results).toHaveLength(0);
  });

  it('aborts and answers the step when a check times out', async () => {
    jest.useFakeTimers();
    try {
      render(<DataCheckOrchestrator contentKey="tab-1" />);

      act(() => {
        dispatchDataCheckRequest(request);
      });
      const signal = mockCapturedInputs[0]?.signal as AbortSignal;

      act(() => {
        jest.advanceTimersByTime(30_000);
      });

      expect(signal.aborted).toBe(true);
      expect(results).toEqual([{ requestId: 'req-1', passed: false, reason: 'The check timed out.' }]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('answers rather than starting work when the assistant is unavailable', async () => {
    mockAssistantAvailable = false;
    render(<DataCheckOrchestrator contentKey="tab-1" />);

    await act(async () => {
      dispatchDataCheckRequest(request);
    });

    expect(mockCapturedInputs).toHaveLength(0);
    expect(results).toHaveLength(1);
    expect(results[0]?.passed).toBe(false);
  });
});
