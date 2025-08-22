import React, { useMemo } from 'react';

export interface VideoRendererProps {
  src?: string;
  baseUrl: string;
  onClick?: () => void;
  [key: string]: any;
}

export function VideoRenderer({ src, type, baseUrl, onClick, ...props }: VideoRendererProps) {
  const resolvedSrc = useMemo(() => {
    const videoSrc = src;
    if (!videoSrc) {
      console.error('VideoRenderer: No video source found', { src });
      return undefined;
    }
    if (!baseUrl) {
      console.warn('VideoRenderer: No baseUrl provided, using relative URL', {
        videoSrc,
      });
      return videoSrc;
    }
    if (videoSrc.startsWith('/') && !videoSrc.startsWith('//')) {
      const resolved = new URL(videoSrc, baseUrl).href;
      return resolved;
    }
    return videoSrc;
  }, [src, baseUrl]);

  return <video src={resolvedSrc} controls />;
}
