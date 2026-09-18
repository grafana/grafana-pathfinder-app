import React, { useEffect, useState } from 'react';

import { testIds } from '../../constants/testIds';
import { formatVmExpiry, parseVmExpiry } from './vm-expiry';

interface VmExpiryIndicatorProps {
  expiresAt: string;
  className: string;
}

export function VmExpiryIndicator({ expiresAt, className }: VmExpiryIndicatorProps) {
  const [clockMs, setClockMs] = useState(() => Date.now());
  const expiryMs = parseVmExpiry(expiresAt);

  useEffect(() => {
    if (expiryMs === null) {
      return undefined;
    }

    const intervalId = setInterval(() => setClockMs(Date.now()), 15_000);
    return () => clearInterval(intervalId);
  }, [expiryMs]);

  const text = formatVmExpiry(expiresAt, clockMs);
  return text ? (
    <span className={className} data-testid={testIds.codaTerminal.vmExpiry}>
      {text}
    </span>
  ) : null;
}
