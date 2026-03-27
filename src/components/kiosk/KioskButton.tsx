import React from 'react';
import { createPortal } from 'react-dom';
import { Icon, useStyles2 } from '@grafana/ui';
import { testIds } from '../../constants/testIds';
import { getKioskButtonStyles } from './kiosk-mode.styles';

interface KioskButtonProps {
  onClick: () => void;
}

export const KioskButton: React.FC<KioskButtonProps> = ({ onClick }) => {
  const styles = useStyles2(getKioskButtonStyles);

  return createPortal(
    <button
      className={styles.button}
      onClick={onClick}
      data-testid={testIds.kioskMode.button}
      aria-label="Open kiosk mode"
    >
      <Icon name="presentation-play" size="md" />
      Kiosk
    </button>,
    document.body
  );
};
