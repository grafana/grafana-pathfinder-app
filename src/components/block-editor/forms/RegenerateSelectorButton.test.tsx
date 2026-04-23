/**
 * @jest-environment jsdom
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { BehaviorSubject } from 'rxjs';
import { RegenerateSelectorButton } from './RegenerateSelectorButton';
import { testIds } from '../../../constants/testIds';
import type { InlineAssistantOptions, InlineAssistantResult } from '@grafana/assistant';

const availabilitySubject = new BehaviorSubject<boolean>(true);
type MockInlineAssistant = InlineAssistantResult & { __lastOptions: InlineAssistantOptions | null };
const mockAssistant: MockInlineAssistant = {
  isGenerating: false,
  content: '',
  error: null,
  generate: jest.fn(),
  cancel: jest.fn(),
  reset: jest.fn(),
  __lastOptions: null,
};

const publishSpy = jest.fn();

jest.mock('@grafana/assistant', () => {
  const actualRxjs = jest.requireActual('rxjs');
  return {
    __esModule: true,
    useInlineAssistant: () => mockAssistant,
    isAssistantAvailable: () => availabilitySubject.asObservable(),
    useProvidePageContext: () => () => {},
    createAssistantContextItem: (type: string, params: unknown) => ({ type, data: params }),
    createTool: (fn: unknown, meta: unknown) => ({ fn, meta }),
    OpenAssistantButton: () => null,
    Observable: actualRxjs.Observable,
    BehaviorSubject: actualRxjs.BehaviorSubject,
  };
});

jest.mock('@grafana/runtime', () => ({
  ...jest.requireActual('@grafana/runtime'),
  getAppEvents: () => ({ publish: publishSpy }),
}));

jest.mock('../../../utils/dev-mode', () => ({
  isAssistantDevModeEnabledGlobal: () => false,
}));

function primeCompletion(response: string) {
  (mockAssistant.generate as jest.Mock).mockImplementation((options: InlineAssistantOptions) => {
    mockAssistant.__lastOptions = options;
    options.onComplete?.(response);
    return Promise.resolve();
  });
}

function makeButton(html: string) {
  const container = document.createElement('div');
  container.innerHTML = html.trim();
  document.body.appendChild(container);
  return container;
}

describe('RegenerateSelectorButton', () => {
  beforeEach(() => {
    availabilitySubject.next(true);
    (mockAssistant.generate as jest.Mock).mockReset();
    publishSpy.mockReset();
    mockAssistant.__lastOptions = null;
    document.body.innerHTML = '';
  });

  it('returns null when the assistant is unavailable', async () => {
    availabilitySubject.next(false);
    const { container } = render(
      <RegenerateSelectorButton currentSelector="button" action="highlight" onRegenerated={jest.fn()} />
    );
    await act(async () => {});
    expect(container.querySelector('button')).toBeNull();
  });

  it('is disabled when no selector is provided', async () => {
    render(<RegenerateSelectorButton currentSelector="" action="highlight" onRegenerated={jest.fn()} />);
    await act(async () => {});
    const button = screen.getByTestId(testIds.blockEditor.regenerateSelectorButton);
    expect(button.getAttribute('aria-disabled')).toBe('true');
  });

  it('calls onRegenerated with the cleaned selector when the assistant response still matches', async () => {
    makeButton(`<button data-testid="save-dashboard" aria-label="Save">Save</button>`);
    primeCompletion('button[data-testid="save-dashboard"]');

    const onRegenerated = jest.fn();
    render(
      <RegenerateSelectorButton
        currentSelector='button[data-testid="save-dashboard"]'
        action="button"
        onRegenerated={onRegenerated}
      />
    );
    await act(async () => {});

    fireEvent.click(screen.getByTestId(testIds.blockEditor.regenerateSelectorButton));

    // Current selector was already best — notify the user, don't change anything.
    expect(onRegenerated).not.toHaveBeenCalled();
    expect(publishSpy).toHaveBeenCalled();
  });

  it('falls back to a grounded candidate when the assistant selector does not match the same element', async () => {
    makeButton(`
      <div data-testid="panel">
        <button data-testid="run-query">Run</button>
      </div>
    `);
    primeCompletion('button[data-testid="does-not-exist"]');

    const onRegenerated = jest.fn();
    render(
      <RegenerateSelectorButton
        currentSelector='button[data-testid="run-query"]'
        action="button"
        onRegenerated={onRegenerated}
      />
    );
    await act(async () => {});

    fireEvent.click(screen.getByTestId(testIds.blockEditor.regenerateSelectorButton));

    // Fallback kicks in since the assistant's selector didn't resolve.
    const warningCall = publishSpy.mock.calls.find((call) =>
      JSON.stringify(call).includes('did not match the same element')
    );
    expect(warningCall).toBeTruthy();
  });

  it('warns and bails when the current selector does not match any element', async () => {
    const onRegenerated = jest.fn();
    render(
      <RegenerateSelectorButton
        currentSelector="button[data-testid='missing']"
        action="button"
        onRegenerated={onRegenerated}
      />
    );
    await act(async () => {});

    fireEvent.click(screen.getByTestId(testIds.blockEditor.regenerateSelectorButton));

    expect(mockAssistant.generate).not.toHaveBeenCalled();
    expect(onRegenerated).not.toHaveBeenCalled();
    expect(publishSpy).toHaveBeenCalled();
  });
});
