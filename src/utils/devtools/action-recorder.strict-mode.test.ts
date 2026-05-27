/**
 * Tests for strict-mode gating in useActionRecorder.
 *
 * Strict mode refuses to record steps whose selector method is not in
 * HIGH_QUALITY_SELECTOR_METHODS (see selector-generator.ts).
 */

import { renderHook, act } from '@testing-library/react';
import { useActionRecorder } from './action-recorder.hook';

function dispatchClick(target: HTMLElement) {
  act(() => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

describe('useActionRecorder \u2014 strict mode', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    document.body.innerHTML = '';
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    document.body.innerHTML = '';
    warnSpy.mockRestore();
  });

  it('records a step when the selector method is high quality (data-testid)', () => {
    const button = document.createElement('button');
    button.setAttribute('data-testid', 'save-btn');
    button.textContent = 'Save';
    document.body.appendChild(button);

    const onSelectorRejected = jest.fn();
    const { result } = renderHook(() =>
      useActionRecorder({ strictMode: true, onSelectorRejected, enableInspector: false })
    );

    act(() => result.current.startRecording());
    dispatchClick(button);

    expect(result.current.recordedSteps).toHaveLength(1);
    expect(result.current.recordedSteps[0]!.selector).toBe("button[data-testid='save-btn']");
    expect(onSelectorRejected).not.toHaveBeenCalled();
  });

  it('refuses to record when the only available selector is fragile (button-text fallback)', () => {
    const button = document.createElement('button');
    button.textContent = 'Some really specific button label';
    document.body.appendChild(button);

    const onSelectorRejected = jest.fn();
    const { result } = renderHook(() =>
      useActionRecorder({ strictMode: true, onSelectorRejected, enableInspector: false })
    );

    act(() => result.current.startRecording());
    dispatchClick(button);

    expect(result.current.recordedSteps).toHaveLength(0);
    expect(onSelectorRejected).toHaveBeenCalledTimes(1);
    const rejection = onSelectorRejected.mock.calls[0]![0];
    expect(rejection.tag).toBe('button');
    expect(rejection.text).toBe('Some really specific button label');
  });

  it('refuses to record on the positional fallback when nothing else matches', () => {
    document.body.innerHTML = '<div><span>only text</span></div>';
    const span = document.querySelector('span') as HTMLElement;

    const onSelectorRejected = jest.fn();
    const { result } = renderHook(() =>
      useActionRecorder({ strictMode: true, onSelectorRejected, enableInspector: false })
    );

    act(() => result.current.startRecording());
    dispatchClick(span);

    expect(result.current.recordedSteps).toHaveLength(0);
    expect(onSelectorRejected).toHaveBeenCalledTimes(1);
  });

  it('records fragile selectors when strict mode is OFF (default)', () => {
    const button = document.createElement('button');
    button.textContent = 'Some really specific button label';
    document.body.appendChild(button);

    const onSelectorRejected = jest.fn();
    const { result } = renderHook(() => useActionRecorder({ onSelectorRejected, enableInspector: false }));

    act(() => result.current.startRecording());
    dispatchClick(button);

    expect(result.current.recordedSteps).toHaveLength(1);
    expect(onSelectorRejected).not.toHaveBeenCalled();
  });
});
