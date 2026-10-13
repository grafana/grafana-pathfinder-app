import React from 'react';
import { render, screen } from '@testing-library/react';
import { Prerequisites } from './Prerequisites';

describe('Prerequisites', () => {
  it('keeps default and unknown formats as exact literal text', () => {
    const literal = '<strong>literal</strong> and **Markdown**';
    const unknown = '[also literal](https://example.com)';

    const { container } = render(
      <Prerequisites
        prerequisites={[
          { id: 'literal', label: literal },
          { id: 'unknown', label: unknown, format: 'html' },
          { id: 'malformed', label: unknown, format: 42 },
        ]}
      />
    );

    expect(screen.getByText(literal)).toBeInTheDocument();
    expect(screen.getAllByText(unknown)).toHaveLength(2);
    expect(container.querySelector('strong')).not.toBeInTheDocument();
    expect(container.querySelector('a')).not.toBeInTheDocument();
  });

  it('renders only supported inline Markdown formatting', () => {
    const { container } = render(
      <Prerequisites
        prerequisites={[
          {
            id: 'formatted',
            label: 'Use **strong**, *emphasis*, `code`, and [the docs](https://example.com/guide).',
            format: 'markdown',
          },
        ]}
      />
    );

    expect(container.querySelector('strong')).toHaveTextContent('strong');
    expect(container.querySelector('em')).toHaveTextContent('emphasis');
    expect(container.querySelector('code')).toHaveTextContent('code');
    expect(screen.getByRole('link', { name: 'the docs' })).toHaveAttribute('href', 'https://example.com/guide');
  });

  it('escapes raw HTML and blocks images and embeds without loading resources', () => {
    const fetchSpy = jest.fn();
    const fetchDescriptor = Object.getOwnPropertyDescriptor(global, 'fetch');
    Object.defineProperty(global, 'fetch', { configurable: true, value: fetchSpy });
    const rawHtml = '<img src="https://example.com/image.png" onerror="alert(1)">';

    try {
      const { container } = render(
        <Prerequisites
          prerequisites={[
            { id: 'raw-html', label: rawHtml, format: 'markdown' },
            { id: 'markdown-image', label: '![diagram](https://example.com/diagram.png)', format: 'markdown' },
            { id: 'embed', label: '<iframe src="https://example.com/embed"></iframe>', format: 'markdown' },
            { id: 'heading', label: '# Not a heading', format: 'markdown' },
            { id: 'list', label: '- Not a nested list', format: 'markdown' },
            { id: 'button', label: '<button>Not interactive</button>', format: 'markdown' },
          ]}
        />
      );

      expect(screen.getByText(rawHtml)).toBeInTheDocument();
      expect(screen.getByText('![diagram](https://example.com/diagram.png)')).toBeInTheDocument();
      expect(screen.getByText('# Not a heading')).toBeInTheDocument();
      expect(screen.getByText('- Not a nested list')).toBeInTheDocument();
      expect(screen.getByText('Not interactive')).toBeInTheDocument();
      expect(
        container.querySelector('img, iframe, embed, object, button, h1, h2, li ul, li ol')
      ).not.toBeInTheDocument();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      if (fetchDescriptor) {
        Object.defineProperty(global, 'fetch', fetchDescriptor);
      } else {
        delete (global as Record<string, unknown>).fetch;
      }
    }
  });

  it.each([
    'javascript:alert(1)',
    'j%61vascript:alert(1)',
    'http://example.com',
    'https://user:pass@example.com',
    'data:text/html,blocked',
    'vbscript:blocked',
    '../relative',
    '/root-relative',
    '#fragment',
  ])('renders an invalid Markdown destination as text: %s', (destination) => {
    render(
      <Prerequisites prerequisites={[{ id: destination, label: `[blocked](${destination})`, format: 'markdown' }]} />
    );

    expect(screen.getByText('blocked')).not.toHaveAttribute('href');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('opens enabled HTTPS links in a new tab without cancelling their click', () => {
    render(
      <Prerequisites
        prerequisites={[{ id: 'docs', label: '[Read the docs](https://example.com/docs)', format: 'markdown' }]}
      />
    );

    const link = screen.getByRole('link', { name: 'Read the docs' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');

    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    expect(link.dispatchEvent(click)).toBe(true);
  });
});
