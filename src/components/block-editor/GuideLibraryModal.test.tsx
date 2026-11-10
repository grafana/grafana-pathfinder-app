import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { decodeAppPlatformGuideBlocks } from '../../types/app-platform-guide-compat';
import { lintGuide } from './lint/guide-lint';
import { GuideLibraryModal, type GuideLibraryModalProps } from './GuideLibraryModal';

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

describe('GuideLibraryModal', () => {
  it('lists catalogue entries by title and resource name, without a block count', () => {
    renderLibrary({
      guides: [{ id: 'team-guide', name: 'team-guide-v2', title: 'Team guide', status: 'published' }],
    });

    expect(screen.getByText('Team guide')).toBeInTheDocument();
    expect(screen.getByText('team-guide-v2')).toBeInTheDocument();
    expect(screen.getByText('Published')).toBeInTheDocument();
    expect(screen.queryByText(/blocks/)).not.toBeInTheDocument();
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
      'team-guide-v2'
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

    await waitFor(() => expect(onLoadGuide).toHaveBeenCalledWith(expect.objectContaining({ blocks }), 'draft'));
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
