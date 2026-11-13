import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { decodeAppPlatformGuideBlocks } from '../../types/app-platform-guide-compat';
import { lintGuide } from './lint/guide-lint';
import { GuideLibraryModal, type GuideLibraryModalProps, type StoredGuide } from './GuideLibraryModal';

function renderLibrary(props: Partial<GuideLibraryModalProps>) {
  return render(
    <GuideLibraryModal
      isOpen
      onClose={jest.fn()}
      guides={[]}
      isLoading={false}
      error={null}
      readGuide={jest.fn()}
      onLoadGuide={jest.fn()}
      onDeleteGuide={jest.fn()}
      onRefresh={jest.fn()}
      {...props}
    />
  );
}

/** A read the test settles by hand. */
function pendingRead() {
  let settle!: { resolve: (value: StoredGuide) => void; reject: (reason: unknown) => void };
  const promise = new Promise<StoredGuide | undefined>((resolve, reject) => (settle = { resolve, reject }));
  return { promise, settle };
}

// Grafana's Button disables through aria-disabled, which toBeDisabled() does not read.
const loadDisabled = () => screen.getByRole('button', { name: /Load/ }).getAttribute('aria-disabled') === 'true';

const stored = (name: string) => ({ metadata: { name }, spec: { id: name, title: name, blocks: [] } });
const entry = (name: string) => ({ id: name, name, title: name });

describe('GuideLibraryModal', () => {
  it('cancels a load in flight when the library is dismissed, so later edits survive', async () => {
    const read = pendingRead();
    const onLoadGuide = jest.fn();
    renderLibrary({ guides: [entry('g')], readGuide: jest.fn(() => read.promise), onLoadGuide });

    fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await act(async () => read.settle.resolve(stored('g')));

    expect(onLoadGuide).not.toHaveBeenCalled();
  });

  it('drops the error of a load that fails after the library was dismissed', async () => {
    const read = pendingRead();
    renderLibrary({ guides: [entry('g')], readGuide: jest.fn(() => read.promise) });

    fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await act(async () => read.settle.reject(new Error('read failed')));

    expect(screen.queryByText('read failed')).not.toBeInTheDocument();
  });

  it('re-enables Load at once after a dismissal, even while the cancelled read hangs', () => {
    renderLibrary({ guides: [entry('g')], readGuide: jest.fn(() => pendingRead().promise) });

    fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    expect(loadDisabled()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(loadDisabled()).toBe(false);
  });

  it('keeps a newer load running when a cancelled one settles', async () => {
    const first = pendingRead();
    const second = pendingRead();
    const readGuide = jest.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const onLoadGuide = jest.fn();
    renderLibrary({ guides: [entry('g')], readGuide, onLoadGuide });

    fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    await act(async () => first.settle.resolve(stored('g')));

    expect(loadDisabled()).toBe(true);
    expect(onLoadGuide).not.toHaveBeenCalled();
    await act(async () => second.settle.resolve(stored('g')));
    expect(onLoadGuide).toHaveBeenCalledTimes(1);
  });

  it('lists catalogue entries by title and resource name, without a block count', () => {
    renderLibrary({
      guides: [{ id: 'team-guide', name: 'team-guide-v2', title: 'Team guide', status: 'published' }],
    });

    expect(screen.getByText('Team guide')).toBeInTheDocument();
    expect(screen.getByText('team-guide-v2')).toBeInTheDocument();
    expect(screen.getByText('Published')).toBeInTheDocument();
    expect(screen.queryByText(/blocks/)).not.toBeInTheDocument();
  });

  it('shows only the error, not the empty-library prompt, when the catalogue is unavailable', () => {
    renderLibrary({ error: 'The guide library is unavailable (obo-unavailable).' });

    expect(screen.getByText('The guide library is unavailable (obo-unavailable).')).toBeInTheDocument();
    expect(screen.queryByText('No guides in library.')).not.toBeInTheDocument();
  });

  it('reads the selected guide by resource name when loaded', async () => {
    const blocks = [{ type: 'markdown', content: 'Hello' }];
    const readGuide = jest.fn().mockResolvedValue({
      metadata: { name: 'team-guide-v2' },
      spec: { id: 'team-guide', title: 'Team guide', blocks },
    });
    const onLoadGuide = jest.fn();
    renderLibrary({
      guides: [{ id: 'team-guide', name: 'team-guide-v2', title: 'Team guide' }],
      readGuide,
      onLoadGuide,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Load' }));

    await waitFor(() => expect(onLoadGuide).toHaveBeenCalled());
    expect(readGuide).toHaveBeenCalledWith('team-guide-v2');
    expect(onLoadGuide).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'team-guide', title: 'Team guide', blocks }),
      'team-guide-v2',
      await readGuide.mock.results[0]!.value
    );
  });

  it('opens an unfinished multistep draft for editing while runtime readers reject it', async () => {
    const blocks = [{ type: 'multistep', content: 'In progress', steps: [] }];
    const onLoadGuide = jest.fn();
    renderLibrary({
      guides: [{ id: 'draft', name: 'draft', title: 'Draft' }],
      readGuide: jest.fn().mockResolvedValue({
        metadata: { name: 'draft' },
        spec: { id: 'draft', title: 'Draft', blocks },
      }),
      onLoadGuide,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Load' }));

    await waitFor(() =>
      expect(onLoadGuide).toHaveBeenCalledWith(expect.objectContaining({ blocks }), 'draft', expect.anything())
    );
    expect(lintGuide(onLoadGuide.mock.calls[0][0]).forPath(['blocks', 0, 'steps'])).toEqual(
      expect.arrayContaining([expect.objectContaining({ severity: 'error' })])
    );
    expect(decodeAppPlatformGuideBlocks(blocks).ok).toBe(false);
  });

  it('reports a stored guide with missing blocks when loaded', async () => {
    renderLibrary({
      guides: [{ id: 'broken', name: 'broken', title: 'Broken guide' }],
      readGuide: jest
        .fn()
        .mockResolvedValue({ metadata: { name: 'broken' }, spec: { id: 'broken', title: 'Broken guide' } }),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Load' }));

    expect(await screen.findByText('Cannot load guide: missing or invalid blocks array')).toBeInTheDocument();
  });

  it('reports a guide deleted since the catalogue was listed', async () => {
    const onLoadGuide = jest.fn();
    renderLibrary({
      guides: [{ id: 'gone', name: 'gone', title: 'Gone guide' }],
      readGuide: jest.fn().mockResolvedValue(undefined),
      onLoadGuide,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Load' }));

    expect(await screen.findByText('Cannot load guide: "gone" was not found on the server')).toBeInTheDocument();
    expect(onLoadGuide).not.toHaveBeenCalled();
  });

  it('shows a failed read instead of loading', async () => {
    renderLibrary({
      guides: [{ id: 'team-guide', name: 'team-guide', title: 'Team guide' }],
      readGuide: jest
        .fn()
        .mockRejectedValue(new Error('Could not read the saved guide "team-guide": denied (HTTP 403)')),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Load' }));

    expect(
      await screen.findByText('Could not read the saved guide "team-guide": denied (HTTP 403)')
    ).toBeInTheDocument();
  });
});
