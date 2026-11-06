import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { GuideLibraryModal } from './GuideLibraryModal';

describe('GuideLibraryModal', () => {
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
