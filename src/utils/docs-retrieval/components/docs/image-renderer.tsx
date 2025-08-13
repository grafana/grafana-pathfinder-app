import React, { useMemo } from 'react';

export interface ImageRendererProps {
  src?: string;
  dataSrc?: string;
  alt?: string;
  width?: string | number;
  height?: string | number;
  className?: string;
  baseUrl: string;
  title?: string;
  onClick?: () => void;
  [key: string]: any;
}

export function ImageRenderer({
  src,
  dataSrc,
  alt,
  width,
  height,
  className,
  baseUrl,
  title,
  onClick,
  ...props
}: ImageRendererProps) {
  const resolvedSrc = useMemo(() => {
    // Handle both camelCase dataSrc and kebab-case data-src
    const imgSrc = src || dataSrc || (props as any)['data-src'];
    if (!imgSrc) {
      console.error('ImageRenderer: No image source found', { src, dataSrc, 'data-src': (props as any)['data-src'] });
      return undefined;
    }
    if (!baseUrl) {
      console.warn('ImageRenderer: No baseUrl provided, using relative URL', { imgSrc });
      return imgSrc;
    }
    if (imgSrc.startsWith('/') && !imgSrc.startsWith('//')) {
      const resolved = new URL(imgSrc, baseUrl).href;
      return resolved;
    }
    return imgSrc;
  }, [src, dataSrc, baseUrl, props]);

  return (
    <img
      src={resolvedSrc}
      alt={alt || ''}
      title={title || alt}
      width={width}
      height={height}
      className={`content-image${className ? ` ${className}` : ''}`}
      onClick={onClick}
      {...props}
    />
  );
}
