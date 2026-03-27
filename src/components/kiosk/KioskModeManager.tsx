import React, { useState } from 'react';
import { KioskButton } from './KioskButton';
import { KioskOverlay } from './KioskOverlay';

interface KioskModeManagerProps {
  rulesUrl: string;
  targetUrl: string;
}

export const KioskModeManager: React.FC<KioskModeManagerProps> = ({ rulesUrl, targetUrl }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <KioskButton onClick={() => setIsOpen(true)} />
      {isOpen && <KioskOverlay rulesUrl={rulesUrl} targetUrl={targetUrl} onClose={() => setIsOpen(false)} />}
    </>
  );
};
