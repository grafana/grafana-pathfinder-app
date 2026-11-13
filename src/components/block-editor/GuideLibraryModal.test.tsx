import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { decodeAppPlatformGuideBlocks } from '../../types/app-platform-guide-compat';
import { lintGuide } from './lint/guide-lint';
import { GuideLibraryModal } from './GuideLibraryModal';

describe('GuideLibraryModal', () => {
  it('opens an unfinished multistep draft for editing while runtime readers reject it', () => {
    const blocks = [{ type: 'multistep', content: 'In progress', steps: [] }];
    const onLoadGuide = jest.fn();
    render(
      <GuideLibraryModal
        isOpen
        onClose={jest.fn()}
        guides={[{ metadata: { name: 'draft', namespace: 'stacks-1' }, spec: { id: 'draft', title: 'Draft', blocks } }]}
        isLoading={false}
        error={null}
        onLoadGuide={onLoadGuide}
        onDeleteGuide={jest.fn()}
        onRefresh={jest.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    expect(onLoadGuide).toHaveBeenCalledWith(expect.objectContaining({ blocks }), 'draft');
    expect(lintGuide(onLoadGuide.mock.calls[0][0]).forPath(['blocks', 0, 'steps'])).toEqual(
      expect.arrayContaining([expect.objectContaining({ severity: 'error' })])
    );
    expect(decodeAppPlatformGuideBlocks(blocks).ok).toBe(false);
  });

  it('renders a malformed guide and reports its missing blocks when loaded', () => {
    render(
      <GuideLibraryModal
        isOpen
        onClose={jest.fn()}
        guides={[
          {
            metadata: { name: 'broken', namespace: 'stacks-1' },
            spec: { id: 'broken', title: 'Broken guide' },
          },
        ]}
        isLoading={false}
        error={null}
        onLoadGuide={jest.fn()}
        onDeleteGuide={jest.fn()}
        onRefresh={jest.fn()}
      />
    );

    expect(screen.getByText(/Invalid blocks/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    expect(screen.getByText('Cannot load guide: missing or invalid blocks array')).toBeInTheDocument();
  });
});
