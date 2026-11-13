import React, { useState } from 'react';
import type { KioskImage as ImageSpec } from '../../types/kiosk-page.schema';
import { parseKioskWebUrl } from '../../security/kiosk-url';
import { parseSnapshotUrl, snapshotFileUrl } from '../../lib/pr-preview-core';

export function resolveKioskImageUrl(src: string, catalogUrl: string): string | undefined {
  try {
    const url = new URL(src, catalogUrl || window.location.href);
    if (!parseKioskWebUrl(url.href, window.location.origin)) {
      return undefined;
    }
    const snapshot = parseSnapshotUrl(catalogUrl);
    if (
      snapshot &&
      ['https://interactive-learning.grafana.net', 'https://interactive-learning.grafana-dev.net'].includes(url.origin)
    ) {
      const match = url.pathname.match(/^\/(?:guides|packages)\/(.+)$/);
      if (match) {
        return snapshotFileUrl(snapshot, decodeURIComponent(match[1]!));
      }
    }
    if (snapshot && !/^https:/.test(src)) {
      const asset = parseSnapshotUrl(url.href);
      if (!asset || asset.owner !== snapshot.owner || asset.repo !== snapshot.repo || asset.sha !== snapshot.sha) {
        return undefined;
      }
    }
    return url.href;
  } catch {
    return undefined;
  }
}

export function KioskImage({
  image,
  catalogUrl,
  inline = false,
}: {
  image: ImageSpec;
  catalogUrl: string;
  inline?: boolean;
}) {
  const src = resolveKioskImageUrl(image.src, catalogUrl);
  const [failed, setFailed] = useState<string>();
  const ratio = { auto: undefined, square: '1 / 1', wide: '16 / 9', portrait: '3 / 4' }[image.aspectRatio ?? 'auto'];
  const content =
    src && failed !== src ? (
      <img
        src={src}
        alt={image.decorative ? '' : image.alt}
        referrerPolicy="no-referrer"
        onError={() => setFailed(src)}
        style={{
          display: 'block',
          width: '100%',
          height: ratio ? '100%' : 'auto',
          aspectRatio: ratio,
          objectFit: image.fit ?? 'contain',
          borderRadius: 'var(--kiosk-radius, 8px)',
        }}
      />
    ) : (
      <span role={image.decorative ? undefined : 'img'} aria-label={image.alt}>
        Image unavailable
      </span>
    );
  return inline ? (
    <span>
      {content}
      {image.caption && <span>{image.caption}</span>}
    </span>
  ) : (
    <figure style={{ margin: 0, minWidth: 0 }}>
      {content}
      {image.caption && <figcaption>{image.caption}</figcaption>}
    </figure>
  );
}
