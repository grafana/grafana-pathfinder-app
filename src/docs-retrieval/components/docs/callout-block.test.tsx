import React from 'react';
import { render, screen } from '@testing-library/react';
import { CalloutBlock } from './callout-block';

describe('CalloutBlock', () => {
  it('renders the author-supplied title and content', () => {
    render(
      <CalloutBlock title="Objective">
        <p>Learn the thing.</p>
      </CalloutBlock>
    );
    expect(screen.getByText('Objective')).toBeInTheDocument();
    expect(screen.getByText('Learn the thing.')).toBeInTheDocument();
  });

  it('applies the callout class name', () => {
    render(
      <CalloutBlock title="Objective">
        <p>content</p>
      </CalloutBlock>
    );
    expect(screen.getByTestId('callout-block')).toHaveClass('callout');
  });

  it('emits the author-supplied id on the wrapper', () => {
    render(
      <CalloutBlock title="Objective" id="my-callout">
        <p>content</p>
      </CalloutBlock>
    );
    expect(screen.getByTestId('callout-block')).toHaveAttribute('id', 'my-callout');
  });
});
