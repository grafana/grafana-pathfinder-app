import React from 'react';
import { render } from '@testing-library/react';
import { VideoRenderer } from './video-renderer';

function getVideo(container: HTMLElement): HTMLVideoElement {
  const video = container.querySelector('video');
  if (!video) {
    throw new Error('no <video> rendered');
  }
  return video;
}

describe('VideoRenderer', () => {
  it('resolves a package-relative src against the guide base URL', () => {
    const { container } = render(
      <VideoRenderer src="assets/demo.mp4" baseUrl="https://cdn.example.com/pkg/content.json" />
    );
    expect(getVideo(container)).toHaveAttribute('src', 'https://cdn.example.com/pkg/assets/demo.mp4');
  });

  it('resolves a root-absolute src against the base origin', () => {
    const { container } = render(
      <VideoRenderer src="/media/demo.mp4" baseUrl="https://cdn.example.com/pkg/content.json" />
    );
    expect(getVideo(container)).toHaveAttribute('src', 'https://cdn.example.com/media/demo.mp4');
  });

  it('leaves a fully-qualified src unchanged', () => {
    const { container } = render(
      <VideoRenderer src="https://cdn.example.com/video.mp4" baseUrl="https://grafana.com/docs/" />
    );
    expect(getVideo(container)).toHaveAttribute('src', 'https://cdn.example.com/video.mp4');
  });

  it('falls back to grafana.com for synthetic block-editor bases', () => {
    const { container } = render(<VideoRenderer src="assets/demo.mp4" baseUrl="block-editor://preview/123" />);
    expect(getVideo(container)).toHaveAttribute('src', 'https://grafana.com/assets/demo.mp4');
  });
});
