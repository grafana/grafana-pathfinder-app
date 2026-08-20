/**
 * Tests for TerminalConnectBlockForm.
 *
 * The form rebuilds the block object from scratch on submit, so any field it
 * does not know about is silently dropped the moment an author opens an existing
 * block for editing. `gcx` is therefore only durable if the form carries it —
 * which is what these tests pin.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

import { TerminalConnectBlockForm } from './TerminalConnectBlockForm';
import { useCodaOptions, useCodaTemplateOptions } from './useCodaOptions';
import type { JsonTerminalConnectBlock } from '../../../types/json-guide.types';
import type { JsonBlock } from '../types';

jest.mock('@grafana/runtime', () => ({
  getBackendSrv: jest.fn(),
}));

jest.mock('./useCodaOptions', () => ({
  useCodaOptions: jest.fn(),
  useCodaTemplateOptions: jest.fn(),
}));

const mockedUseCodaOptions = useCodaOptions as jest.MockedFunction<typeof useCodaOptions>;
const mockedUseCodaTemplateOptions = useCodaTemplateOptions as jest.MockedFunction<typeof useCodaTemplateOptions>;

// Grafana's Combobox sizes its options through a <canvas> 2d context, which
// jsdom does not provide. Same local stub as ChallengeBlockForm.test.tsx — the
// project-wide polyfill intentionally stays minimal.
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = jest.fn(() => ({
    measureText: () => ({ width: 0 }),
    font: '',
  })) as unknown as HTMLCanvasElement['getContext'];
});

beforeEach(() => {
  jest.clearAllMocks();
  mockedUseCodaOptions.mockReturnValue({ options: [], isLoading: false, unavailable: false });
  mockedUseCodaTemplateOptions.mockReturnValue({ options: [], isLoading: false });
});

function renderForm(initialData?: JsonTerminalConnectBlock) {
  const onSubmit = jest.fn();
  render(
    <TerminalConnectBlockForm
      initialData={initialData as JsonBlock | undefined}
      onSubmit={onSubmit}
      onCancel={jest.fn()}
      isEditing={initialData !== undefined}
    />
  );
  return onSubmit;
}

function submitted(onSubmit: jest.Mock): JsonTerminalConnectBlock {
  fireEvent.click(screen.getByText(/block$/));
  return onSubmit.mock.calls[0]![0] as JsonTerminalConnectBlock;
}

describe('TerminalConnectBlockForm gcx', () => {
  it('omits gcx entirely when the author leaves it off', () => {
    const onSubmit = renderForm();
    fireEvent.change(screen.getByPlaceholderText(/Click the button below/), { target: { value: 'Connect' } });

    // Absent, not `false`: an omitted field keeps existing guides byte-identical.
    expect(submitted(onSubmit)).not.toHaveProperty('gcx');
  });

  it('emits gcx: true when the author ticks it', () => {
    const onSubmit = renderForm();
    fireEvent.change(screen.getByPlaceholderText(/Click the button below/), { target: { value: 'Connect' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /set up gcx/i }));

    expect(submitted(onSubmit).gcx).toBe(true);
  });

  it('preserves gcx across an edit round-trip', () => {
    const onSubmit = renderForm({ type: 'terminal-connect', content: 'Connect', gcx: true });

    expect(screen.getByRole('checkbox', { name: /set up gcx/i })).toBeChecked();
    expect(submitted(onSubmit).gcx).toBe(true);
  });

  it('lets an author turn gcx back off', () => {
    const onSubmit = renderForm({ type: 'terminal-connect', content: 'Connect', gcx: true });
    fireEvent.click(screen.getByRole('checkbox', { name: /set up gcx/i }));

    expect(submitted(onSubmit)).not.toHaveProperty('gcx');
  });

  it('keeps gcx alongside the VM options', () => {
    const onSubmit = renderForm({
      type: 'terminal-connect',
      content: 'Connect',
      vmTemplate: 'vm-aws-sample-app',
      vmApp: 'nginx',
      gcx: true,
    });

    expect(submitted(onSubmit)).toMatchObject({
      vmTemplate: 'vm-aws-sample-app',
      vmApp: 'nginx',
      gcx: true,
    });
  });
});
