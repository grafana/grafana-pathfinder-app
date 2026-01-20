import React, { useMemo, useEffect, useRef } from 'react';

export interface VideoRendererProps {
  src?: string;
  baseUrl: string;
  onClick?: () => void;
  start?: number;
  end?: number;
  [key: string]: any;
}

export function VideoRenderer({ src, type, baseUrl, onClick, start, end, ...props }: VideoRendererProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Handle start and end times
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Set start time when video metadata is loaded
    const handleLoadedMetadata = () => {
      if (start !== undefined && start >= 0) {
        video.currentTime = start;
      }
    };

    // Handle end time - pause when reaching end
    const handleTimeUpdate = () => {
      if (end !== undefined && end >= 0 && video.currentTime >= end) {
        video.pause();
        video.currentTime = end;
      }
    };

    // If video is already ready, set start time immediately
    if (video.readyState >= 1 && start !== undefined && start >= 0) {
      video.currentTime = start;
    }

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('timeupdate', handleTimeUpdate);

    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('timeupdate', handleTimeUpdate);
    };
  }, [start, end]);
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

  return <video ref={videoRef} src={resolvedSrc} controls {...props} />;
}
