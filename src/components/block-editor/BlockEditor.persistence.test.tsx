import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { testIds } from '../../constants/testIds';
import { BlockEditor } from './BlockEditor';

describe('BlockEditor persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps preview mode selected after the first persistence write', () => {
    render(<BlockEditor />);

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

    expect(screen.queryByTestId(testIds.blockEditor.palette)).not.toBeInTheDocument();
  });
});
