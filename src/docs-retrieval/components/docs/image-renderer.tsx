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
      console.error('ImageRenderer: No image source found', {
        src,
        dataSrc,
        'data-src': (props as any)['data-src'],
      });
      return undefined;
    }

    // Skip if already absolute URL or data URI
    if (
      imgSrc.startsWith('http://') ||
      imgSrc.startsWith('https://') ||
      imgSrc.startsWith('//') ||
      imgSrc.startsWith('data:')
    ) {
      return imgSrc;
    }

    // No baseUrl provided, return as-is
    if (!baseUrl) {
      return imgSrc;
    }

    // Fallback to https://grafana.com/ for synthetic URLs (like block-editor://)
    const effectiveBaseUrl =
      baseUrl.startsWith('http://') || baseUrl.startsWith('https://') ? baseUrl : 'https://grafana.com/';

    // Resolve path against effective baseUrl
    const resolved = new URL(imgSrc, effectiveBaseUrl).href;
    return resolved;
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
