/**
 * Tests for `selectorMethod` stamping on recorded steps.
 *
 * The recorder copies `selectorInfo.method` onto each `RecordedStep` as
 * `selectorMethod` so that consumers (e.g. BlockEditor's strict-mode
 * confirmation) can filter for low-quality selectors via
 * `isHighQualitySelectorMethod`.
 */

import { renderHook, act } from '@testing-library/react';
import { useActionRecorder } from './action-recorder.hook';

function dispatchClick(target: HTMLElement) {
  act(() => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

describe('useActionRecorder — selectorMethod stamping', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it("stamps 'data-testid' on a step generated from a data-testid element", () => {
    const button = document.createElement('button');
    button.setAttribute('data-testid', 'save-btn');
    button.textContent = 'Save';
    document.body.appendChild(button);

    const { result } = renderHook(() => useActionRecorder({ enableInspector: false }));
    act(() => result.current.startRecording());
    dispatchClick(button);

    expect(result.current.recordedSteps).toHaveLength(1);
    expect(result.current.recordedSteps[0]!.selectorMethod).toBe('data-testid');
  });

  it('stamps a positional method when no stable attribute exists', () => {
    document.body.innerHTML = '<div><span>only text</span></div>';
    const span = document.querySelector('span') as HTMLElement;

    const { result } = renderHook(() => useActionRecorder({ enableInspector: false }));
    act(() => result.current.startRecording());
    dispatchClick(span);

    expect(result.current.recordedSteps).toHaveLength(1);
    // Either 'nth-of-type' (winner from generateCandidates) or 'fallback' (catch-all
    // when even nth-of-type misses). Both are outside the high-quality allow-list.
    expect(['nth-of-type', 'fallback']).toContain(result.current.recordedSteps[0]!.selectorMethod);
  });
});
