import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

import { SelectorHealthBadge } from './SelectorHealthBadge';

describe('SelectorHealthBadge', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('shows the generator-derived method and stability score for a data-testid selector', async () => {
    document.body.innerHTML = '<button data-testid="save">Save</button>';

    render(<SelectorHealthBadge reftarget="button[data-testid='save']" />);

    await waitFor(() => expect(screen.getByText('data-testid')).toBeInTheDocument(), { timeout: 2000 });
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('1 match')).toBeInTheDocument();
  });

  it('rates a bare positional selector with a low stability score', async () => {
    document.body.innerHTML = '<button>A</button><button id="second">B</button>';

    render(<SelectorHealthBadge reftarget="button:nth-of-type(2)" />);

    await waitFor(() => expect(screen.getByText('nth-of-type')).toBeInTheDocument(), { timeout: 2000 });
    expect(screen.getByText('20')).toBeInTheDocument();
  });
});
