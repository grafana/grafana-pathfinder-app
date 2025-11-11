import React, { useEffect, useRef, useCallback } from 'react';
import { reportAppInteraction, UserInteraction } from '../../../lib/analytics';

export interface YouTubeVideoRendererProps {
  src: string;
  width?: string | number;
  height?: string | number;
  title?: string;
  className?: string;
  [key: string]: any;
}

// Declare YouTube API types
declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

let apiLoaded = false;
let apiLoading = false;

export function YouTubeVideoRenderer({
  src,
  width = 560,
  height = 315,
  title,
  className,
  ...props
}: YouTubeVideoRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const playerRef = useRef<any>(null);
  const playEventTrackedRef = useRef(false);
  const viewStartTimeRef = useRef<number | null>(null);
  const totalViewTimeRef = useRef<number>(0);
  const lastPositionRef = useRef<number>(0);
  const actualVideoTitleRef = useRef<string | null>(null);

  // Extract video ID from YouTube URL
  const getVideoId = useCallback((url: string): string | null => {
    // SECURITY: Prevent ReDoS attacks with length limit
    if (url.length > 500) {
      return null;
    }

    // SECURITY: Safer regex pattern - simplified to avoid backtracking
    // Removed .* pattern in favor of more constrained alternatives
    const regex = /(?:youtube\.com\/(?:embed\/|watch\?.*v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
    const match = url.match(regex);
    return match ? match[1] : null;
  }, []);

  // Get document info for analytics
  const getDocumentInfo = useCallback(() => {
    try {
      const tabUrl = (window as any).__DocsPluginActiveTabUrl as string | undefined;
      const contentKey = (window as any).__DocsPluginContentKey as string | undefined;

      const sourceDocument = tabUrl || contentKey || window.location.pathname || 'unknown';

      // Use actual video title from YouTube API if available, fallback to iframe title, then default
      const videoTitle = actualVideoTitleRef.current || title || 'YouTube Video';

      return {
        source_document: sourceDocument,
        video_url: src,
        video_title: videoTitle,
      };
    } catch {
      return {
        source_document: 'unknown',
        video_url: src,
        video_title: actualVideoTitleRef.current || title || 'YouTube Video',
      };
    }
  }, [src, title]);

  // Track video viewing duration
  const trackViewLength = useCallback(() => {
    if (totalViewTimeRef.current > 0) {
      const docInfo = getDocumentInfo();
      const videoId = getVideoId(src);

      // Get additional video info from player if available
      let videoDuration = 0;
      let videoPosition = 0;

      try {
        if (playerRef.current && playerRef.current.getDuration) {
          videoDuration = Math.round(playerRef.current.getDuration());
        }
        if (playerRef.current && playerRef.current.getCurrentTime) {
          videoPosition = Math.round(playerRef.current.getCurrentTime());
        }
      } catch (error) {
        console.warn('Could not get video duration/position:', error);
      }

      reportAppInteraction(UserInteraction.VideoViewLength, {
        ...docInfo,
        video_id: videoId || 'unknown',
        view_length_seconds: Math.round(totalViewTimeRef.current),
        video_duration_seconds: videoDuration,
        video_position_seconds: videoPosition,
        view_percentage: videoDuration > 0 ? Math.round((totalViewTimeRef.current / videoDuration) * 100) : 0,
        interaction_location: 'youtube_iframe',
      });
    }
  }, [getDocumentInfo, getVideoId, src]);

  // Load YouTube iframe API
  const loadYouTubeAPI = useCallback(() => {
    if (apiLoaded || apiLoading) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      apiLoading = true;

      // Set up the global callback
      window.onYouTubeIframeAPIReady = () => {
        apiLoaded = true;
        apiLoading = false;
        resolve();
      };

      // Load the API script
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      document.head.appendChild(script);
    });
  }, []);

  // Initialize YouTube player with analytics
  const initializePlayer = useCallback(async () => {
    const videoId = getVideoId(src);
    if (!videoId || !window.YT || !iframeRef.current) {
      return;
    }

    try {
      // Create a unique iframe ID
      const iframeId = `youtube-player-${videoId}-${Date.now()}`;
      iframeRef.current.id = iframeId;

      playerRef.current = new window.YT.Player(iframeId, {
        events: {
          onReady: (event: any) => {
            // Get the actual video title from YouTube API
            try {
              const videoData = event.target.getVideoData();
              if (videoData && videoData.title) {
                actualVideoTitleRef.current = videoData.title;
              }
            } catch (error) {
              console.warn('Could not get video title from YouTube API:', error);
            }
          },
          onStateChange: (event: any) => {
            const currentTime = Date.now();

            if (event.data === window.YT.PlayerState.PLAYING) {
              // Track video play event (only once per video)
              if (!playEventTrackedRef.current) {
                const docInfo = getDocumentInfo();
                reportAppInteraction(UserInteraction.VideoPlayClick, {
                  ...docInfo,
                  interaction_location: 'youtube_iframe',
                });

                playEventTrackedRef.current = true;
              }

              // Start tracking view time
              viewStartTimeRef.current = currentTime;

              // Update last position for duration calculation
              try {
                if (playerRef.current && playerRef.current.getCurrentTime) {
                  lastPositionRef.current = playerRef.current.getCurrentTime();
                }
              } catch (error) {
                console.warn('Could not get current video position:', error);
              }
            } else if (event.data === window.YT.PlayerState.PAUSED || event.data === window.YT.PlayerState.ENDED) {
              // Calculate and accumulate viewing time
              if (viewStartTimeRef.current) {
                const viewDuration = (currentTime - viewStartTimeRef.current) / 1000; // Convert to seconds
                totalViewTimeRef.current += viewDuration;
                viewStartTimeRef.current = null;
              }

              // Track view length when video is paused or ended
              if (event.data === window.YT.PlayerState.ENDED || totalViewTimeRef.current >= 5) {
                // Only track if user watched for at least 5 seconds or video ended
                trackViewLength();
              }
            }
          },
        },
      });
    } catch (error) {
      console.warn('Failed to initialize YouTube player for analytics:', error);
    }
  }, [src, getVideoId, getDocumentInfo, trackViewLength]);

  // Load API and initialize player
  useEffect(() => {
    const setupPlayer = async () => {
      try {
        await loadYouTubeAPI();

        // Small delay to ensure iframe is rendered
        setTimeout(() => {
          initializePlayer();
        }, 100);
      } catch (error) {
        console.warn('Failed to setup YouTube analytics tracking:', error);
      }
    };

    setupPlayer();

    // Cleanup
    return () => {
      // Track final view length if user was watching when component unmounts
      if (viewStartTimeRef.current) {
        const viewDuration = (Date.now() - viewStartTimeRef.current) / 1000;
        totalViewTimeRef.current += viewDuration;
      }

      // Send final analytics if user watched for meaningful time
      if (totalViewTimeRef.current >= 5) {
        trackViewLength();
      }

      if (playerRef.current && playerRef.current.destroy) {
        try {
          playerRef.current.destroy();
        } catch (error) {
          console.warn('Error destroying YouTube player:', error);
        }
      }
    };
  }, [loadYouTubeAPI, initializePlayer, trackViewLength]);

  const videoId = getVideoId(src);
  if (!videoId) {
    console.warn('Invalid YouTube URL provided to YouTubeVideoRenderer:', src);
    // Fallback to regular iframe
    return (
      <iframe
        ref={iframeRef}
        src={src}
        width={width}
        height={height}
        title={title}
        className={className}
        style={{ border: 0 }}
        allowFullScreen
        {...props}
      />
    );
  }

  // Preserve original URL and simply append enablejsapi=1 if not present
  const embedUrl = (() => {
    // Check if enablejsapi is already in the URL
    if (src.includes('enablejsapi=1')) {
      return src; // Already has the API enabled
    }

    // Add enablejsapi=1 to existing URL
    const separator = src.includes('?') ? '&' : '?';
    return `${src}${separator}enablejsapi=1`;
  })();

  return (
    <iframe
      ref={iframeRef}
      src={embedUrl}
      width={width}
      height={height}
      title={title || 'YouTube video player'}
      className={className}
      style={{ border: 0 }}
      allowFullScreen
      {...props}
    />
  );
}
