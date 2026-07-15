import React from 'react';
import { render, screen } from '@testing-library/react';
import { VimeoVideoRenderer } from './vimeo-video-renderer';

function getIframeSrc(): string {
  const iframe = document.querySelector('iframe');
  if (!iframe) {
    throw new Error('no <iframe> rendered');
  }
  return iframe.getAttribute('src') ?? '';
}

describe('VimeoVideoRenderer', () => {
  it('builds a player embed URL from a raw vimeo.com/<id> URL', () => {
    render(<VimeoVideoRenderer src="https://vimeo.com/76979871" />);
    expect(getIframeSrc()).toBe('https://player.vimeo.com/video/76979871');
  });

  it('preserves an already-embedded player URL', () => {
    render(<VimeoVideoRenderer src="https://player.vimeo.com/video/76979871" />);
    expect(getIframeSrc()).toBe('https://player.vimeo.com/video/76979871');
  });

  it('carries the unlisted hash from a path segment into the h param', () => {
    render(<VimeoVideoRenderer src="https://vimeo.com/76979871/abc123" />);
    expect(getIframeSrc()).toBe('https://player.vimeo.com/video/76979871?h=abc123');
  });

  it('applies a start offset as a media fragment', () => {
    render(<VimeoVideoRenderer src="https://vimeo.com/76979871" start={30} />);
    expect(getIframeSrc()).toBe('https://player.vimeo.com/video/76979871#t=30s');
  });

  it('renders a fallback message for a non-Vimeo URL', () => {
    render(<VimeoVideoRenderer src="https://evil.com/vimeo.com/123" />);
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.getByText('Invalid video URL provided')).toBeInTheDocument();
  });
});
