import React from 'react';
import { render, screen } from '@testing-library/react';
import { ImageRenderer } from './image-renderer';

describe('ImageRenderer', () => {
  describe('URL resolution with synthetic baseUrl', () => {
    it('resolves absolute path to grafana.com when baseUrl is block-editor://', () => {
      render(
        <ImageRenderer
          src="/media/docs/learning-journey/test.png"
          alt="test image"
          baseUrl="block-editor://preview/123"
        />
      );

      const img = screen.getByRole('img');
      expect(img).toHaveAttribute('src', 'https://grafana.com/media/docs/learning-journey/test.png');
    });

    it('resolves bare relative path to grafana.com when baseUrl is block-editor://', () => {
      render(<ImageRenderer src="media/docs/test.png" alt="test image" baseUrl="block-editor://preview/123" />);

      const img = screen.getByRole('img');
      expect(img).toHaveAttribute('src', 'https://grafana.com/media/docs/test.png');
    });

    it('resolves dot-relative path to grafana.com when baseUrl is block-editor://', () => {
      render(<ImageRenderer src="./images/test.png" alt="test image" baseUrl="block-editor://preview/123" />);

      const img = screen.getByRole('img');
      expect(img).toHaveAttribute('src', 'https://grafana.com/images/test.png');
    });
  });

  describe('URL resolution with http/https baseUrl', () => {
    it('resolves absolute path against provided https baseUrl', () => {
      render(<ImageRenderer src="/static/img/test.png" alt="test image" baseUrl="https://grafana.com/docs/grafana/" />);

      const img = screen.getByRole('img');
      expect(img).toHaveAttribute('src', 'https://grafana.com/static/img/test.png');
    });

    it('resolves relative path against provided https baseUrl', () => {
      render(
        <ImageRenderer
          src="images/screenshot.png"
          alt="test image"
          baseUrl="https://grafana.com/docs/grafana/latest/"
        />
      );

      const img = screen.getByRole('img');
      expect(img).toHaveAttribute('src', 'https://grafana.com/docs/grafana/latest/images/screenshot.png');
    });
  });

  describe('absolute URLs are not modified', () => {
    it('preserves https:// URLs unchanged', () => {
      render(
        <ImageRenderer src="https://example.com/image.png" alt="test image" baseUrl="block-editor://preview/123" />
      );

      const img = screen.getByRole('img');
      expect(img).toHaveAttribute('src', 'https://example.com/image.png');
    });

    it('preserves http:// URLs unchanged', () => {
      render(
        <ImageRenderer src="http://example.com/image.png" alt="test image" baseUrl="block-editor://preview/123" />
      );

      const img = screen.getByRole('img');
      expect(img).toHaveAttribute('src', 'http://example.com/image.png');
    });

    it('preserves protocol-relative URLs (//) unchanged', () => {
      render(<ImageRenderer src="//cdn.example.com/image.png" alt="test image" baseUrl="block-editor://preview/123" />);

      const img = screen.getByRole('img');
      expect(img).toHaveAttribute('src', '//cdn.example.com/image.png');
    });

    it('preserves data URIs unchanged', () => {
      const dataUri =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      render(<ImageRenderer src={dataUri} alt="test image" baseUrl="block-editor://preview/123" />);

      const img = screen.getByRole('img');
      expect(img).toHaveAttribute('src', dataUri);
    });
  });

  describe('no baseUrl provided', () => {
    it('returns src as-is when no baseUrl is provided', () => {
      render(<ImageRenderer src="/media/docs/test.png" alt="test image" baseUrl="" />);

      const img = screen.getByRole('img');
      expect(img).toHaveAttribute('src', '/media/docs/test.png');
    });
  });

  describe('dataSrc and data-src fallbacks', () => {
    it('uses dataSrc when src is not provided', () => {
      render(<ImageRenderer dataSrc="/media/docs/test.png" alt="test image" baseUrl="block-editor://preview/123" />);

      const img = screen.getByRole('img');
      expect(img).toHaveAttribute('src', 'https://grafana.com/media/docs/test.png');
    });
  });
});
