import React from 'react';
import { render, screen } from '@testing-library/react';

import { GuidedBlockForm } from './GuidedBlockForm';

describe('GuidedBlockForm', () => {
  it('describes completeEarly as final-action persistence', () => {
    render(<GuidedBlockForm onSubmit={jest.fn()} onCancel={jest.fn()} />);

    expect(screen.getByText('Complete early for final action')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Stores completion during a final click activation, before Grafana handles it. Other final actions store completion after their result.'
      )
    ).toBeInTheDocument();
  });
});
