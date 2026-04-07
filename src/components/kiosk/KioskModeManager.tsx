import React, { useState, useEffect, useCallback } from 'react';
import { KioskOverlay } from './KioskOverlay';

interface KioskModeManagerProps {
  rulesUrl: string;
}

/**
 * Listens for 'pathfinder-open-kiosk' custom events (dispatched from the sidebar)
 * and renders the full-screen kiosk overlay when triggered.
 */
export const KioskModeManager: React.FC<KioskModeManagerProps> = ({ rulesUrl }) => {
  const [isOpen, setIsOpen] = useState(false);

  const handleOpen = useCallback(() => {
    setIsOpen(true);
  }, []);

  useEffect(() => {
    document.addEventListener('pathfinder-open-kiosk', handleOpen);
    return () => {
      document.removeEventListener('pathfinder-open-kiosk', handleOpen);
    };
  }, [handleOpen]);

  if (!isOpen) {
    return null;
  }

  return <KioskOverlay rulesUrl={rulesUrl} onClose={() => setIsOpen(false)} />;
};
