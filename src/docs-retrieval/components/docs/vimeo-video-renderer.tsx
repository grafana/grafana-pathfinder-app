import React from 'react';
import { parseUrlSafely, isVimeoDomain } from '../../../security/url-validator';
import { logger } from '../../../lib/logging';

export interface VimeoVideoRendererProps {
  src: string;
  width?: string | number;
  height?: string | number;
  title?: string;
  className?: string;
  start?: number;
  [key: string]: any;
}

// Vimeo ids are numeric. Private videos carry an unlisted hash, either as a
// path segment (`vimeo.com/<id>/<hash>`) or an `h` query param on the player
// URL (`player.vimeo.com/video/<id>?h=<hash>`).
const VIMEO_ID_PATTERN = /^\d+$/;
const VIMEO_HASH_PATTERN = /^[A-Za-z0-9]+$/;

/**
 * Build a canonical `player.vimeo.com/video/<id>` embed URL from any accepted
 * Vimeo input form, preserving the unlisted hash and applying a start offset.
 * Returns null when the URL is not a recognizable Vimeo video.
 */
function getVimeoEmbedUrl(src: string, start?: number): string | null {
  if (!isVimeoDomain(src)) {
    return null;
  }
  const url = parseUrlSafely(src);
  if (!url) {
    return null;
  }

  const segments = url.pathname.split('/').filter(Boolean);

  // player.vimeo.com/video/<id>[/<hash>]
  let id: string | undefined;
  let hash: string | undefined = url.searchParams.get('h') ?? undefined;

  if (url.hostname === 'player.vimeo.com') {
    const videoIdx = segments.indexOf('video');
    id = videoIdx >= 0 ? segments[videoIdx + 1] : undefined;
    hash = hash ?? segments[videoIdx + 2];
  } else {
    // vimeo.com/<id>[/<hash>] and vimeo.com/channels/<name>/<id>
    const numeric = segments.filter((s) => VIMEO_ID_PATTERN.test(s));
    id = numeric[0];
    const idIdx = id ? segments.indexOf(id) : -1;
    hash = hash ?? (idIdx >= 0 ? segments[idIdx + 1] : undefined);
  }

  if (!id || !VIMEO_ID_PATTERN.test(id)) {
    return null;
  }

  const embed = new URL(`https://player.vimeo.com/video/${id}`);
  if (hash && VIMEO_HASH_PATTERN.test(hash)) {
    embed.searchParams.set('h', hash);
  }
  const built = embed.toString();

  // Start offset uses the media-fragment hash the player understands.
  return start !== undefined && start >= 0 ? `${built}#t=${Math.floor(start)}s` : built;
}

export function VimeoVideoRenderer({
  src,
  width = 560,
  height = 315,
  title,
  className,
  start,
  ...props
}: VimeoVideoRendererProps) {
  const embedUrl = getVimeoEmbedUrl(src, start);

  if (!embedUrl) {
    logger.warn('VimeoVideoRenderer: Invalid Vimeo URL provided', { src });
    return <div style={{ padding: '1rem', color: 'var(--text-secondary)' }}>Invalid video URL provided</div>;
  }

  return (
    <iframe
      src={embedUrl}
      width={width}
      height={height}
      title={title || 'Vimeo video player'}
      className={className}
      style={{ border: 0 }}
      allow="autoplay; fullscreen; picture-in-picture"
      allowFullScreen
      {...props}
    />
  );
}
