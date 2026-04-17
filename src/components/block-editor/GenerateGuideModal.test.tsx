/**
 * @jest-environment jsdom
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BehaviorSubject } from 'rxjs';
import { GenerateGuideModal } from './GenerateGuideModal';
import { testIds } from '../../constants/testIds';
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

jest.mock('../../utils/dev-mode', () => ({
  isAssistantDevModeEnabledGlobal: () => false,
}));

const validGuide = {
  id: 'generated-guide',
  title: 'Generated guide',
  blocks: [{ type: 'markdown', content: 'Hello world' }],
};

function primeGenerator(response: string) {
  (mockAssistant.generate as jest.Mock).mockImplementation((options: InlineAssistantOptions) => {
    mockAssistant.__lastOptions = options;
    options.onComplete?.(response);
    return Promise.resolve();
  });
}

function primeGeneratorError(err: Error) {
  (mockAssistant.generate as jest.Mock).mockImplementation((options: InlineAssistantOptions) => {
    mockAssistant.__lastOptions = options;
    options.onError?.(err);
    return Promise.resolve();
  });
}

function typePrompt(value: string) {
  const textarea = screen.getByTestId(testIds.blockEditor.generateGuidePromptInput) as HTMLTextAreaElement;
  fireEvent.change(textarea, { target: { value } });
}

describe('GenerateGuideModal', () => {
  beforeEach(() => {
    availabilitySubject.next(true);
    (mockAssistant.generate as jest.Mock).mockReset();
    mockAssistant.__lastOptions = null;
  });

  it('calls onGenerated with a validated guide when the assistant returns valid JSON', async () => {
    primeGenerator(JSON.stringify(validGuide));
    const onGenerated = jest.fn();

    render(<GenerateGuideModal isOpen onGenerated={onGenerated} onClose={jest.fn()} hasUnsavedChanges={false} />);

    typePrompt('Walk through Prometheus setup');
    fireEvent.click(screen.getByTestId(testIds.blockEditor.generateGuideSubmit));

    const useGenerated = await screen.findByRole('button', { name: /use generated guide/i });
    fireEvent.click(useGenerated);

    expect(onGenerated).toHaveBeenCalledTimes(1);
    expect(onGenerated.mock.calls[0][0]).toEqual(expect.objectContaining({ id: 'generated-guide' }));
  });

  it('shows validation errors and a Retry button when the JSON is invalid', async () => {
    primeGenerator(JSON.stringify({ id: 'bad', title: 'bad' })); // missing blocks
    const onGenerated = jest.fn();

    render(<GenerateGuideModal isOpen onGenerated={onGenerated} onClose={jest.fn()} hasUnsavedChanges={false} />);

    typePrompt('prompt');
    fireEvent.click(screen.getByTestId(testIds.blockEditor.generateGuideSubmit));

    await waitFor(() => {
      expect(screen.getByText(/did not validate/i)).toBeInTheDocument();
    });
    expect(screen.getByTestId(testIds.blockEditor.generateGuideRetry)).toBeEnabled();
    expect(onGenerated).not.toHaveBeenCalled();
  });

  it('requires confirmation before replacing an existing guide', async () => {
    primeGenerator(JSON.stringify(validGuide));
    const onGenerated = jest.fn();

    render(<GenerateGuideModal isOpen onGenerated={onGenerated} onClose={jest.fn()} hasUnsavedChanges={true} />);

    typePrompt('prompt');
    fireEvent.click(screen.getByTestId(testIds.blockEditor.generateGuideSubmit));

    const useGenerated = await screen.findByRole('button', { name: /use generated guide/i });
    fireEvent.click(useGenerated);

    expect(onGenerated).not.toHaveBeenCalled();
    expect(screen.getByText(/Replace current guide/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /replace guide/i }));
    expect(onGenerated).toHaveBeenCalledTimes(1);
  });

  it('surfaces assistant errors without crashing', async () => {
    primeGeneratorError(new Error('boom'));
    render(<GenerateGuideModal isOpen onGenerated={jest.fn()} onClose={jest.fn()} />);

    typePrompt('prompt');
    fireEvent.click(screen.getByTestId(testIds.blockEditor.generateGuideSubmit));

    await waitFor(() => {
      expect(screen.getByText(/boom/)).toBeInTheDocument();
    });
  });

  it('shows a warning banner when the assistant is unavailable', async () => {
    availabilitySubject.next(false);
    render(<GenerateGuideModal isOpen onGenerated={jest.fn()} onClose={jest.fn()} />);
    await act(async () => {});
    expect(screen.getByText(/Assistant unavailable/i)).toBeInTheDocument();
  });
});
