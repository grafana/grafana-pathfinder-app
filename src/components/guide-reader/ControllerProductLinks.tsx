import React, { useState } from 'react';
import { Alert, useStyles2 } from '@grafana/ui';

import { useControllerChannel, useControllerConnected } from '../../global-state/controller-channel';
import { parseUrlSafely } from '../../security';
import { getGuideReaderStyles } from './guide-reader.styles';

export function ControllerProductLinks({ children }: { children: React.ReactNode }) {
  const styles = useStyles2(getGuideReaderStyles);
  const channel = useControllerChannel();
  const connected = useControllerConnected();
  const [connectionRequired, setConnectionRequired] = useState(false);

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
    if (!anchor || anchor.hasAttribute('download') || anchor.hasAttribute('data-journey-start')) {
      return;
    }
    const href = anchor.getAttribute('href')?.trim();
    if (!href || href.startsWith('#')) {
      return;
    }
    const url = parseUrlSafely(anchor.href);
    if (!url || !['http:', 'https:'].includes(url.protocol) || url.origin !== window.location.origin) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (!channel || !connected) {
      setConnectionRequired(true);
      return;
    }
    setConnectionRequired(false);
    channel.post({ kind: 'navigate-link', url: url.href });
  };

  return (
    <div onClickCapture={handleClick}>
      {connectionRequired && !connected && (
        <div className={styles.controllerLinkAlert}>
          <Alert
            severity="warning"
            title="Connect to your Grafana tab to open this link."
            onRemove={() => setConnectionRequired(false)}
          />
        </div>
      )}
      {children}
    </div>
  );
}
