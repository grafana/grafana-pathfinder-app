/**
 * Popup shown to control group users who attempt to load a document via ?doc= URL.
 * Rendered outside the main React tree via createRoot since module.tsx
 * runs before any component mounts.
 */

import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Modal, useStyles2, Button } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import grotDiscouragedSvg from '../img/Grot-Emotions-Discouraged.svg';
import { reportAppInteraction, UserInteraction } from '../lib/analytics';

const getStyles = (theme: GrafanaTheme2) => ({
  content: css({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    gap: theme.spacing(2),
    padding: theme.spacing(1, 0, 2),
  }),
  image: css({
    width: '160px',
    height: 'auto',
  }),
  message: css({
    fontSize: theme.typography.body.fontSize,
    color: theme.colors.text.primary,
    lineHeight: theme.typography.body.lineHeight,
    maxWidth: '400px',
  }),
});

interface ControlGroupDocPopupProps {
  onDismiss: () => void;
}

function ControlGroupDocPopup({ onDismiss }: ControlGroupDocPopupProps) {
  const styles = useStyles2(getStyles);
  const [isOpen, setIsOpen] = useState(true);

  const handleDismiss = () => {
    setIsOpen(false);
    onDismiss();
  };

  return (
    <Modal title="Access unavailable" isOpen={isOpen} onDismiss={handleDismiss}>
      <div className={styles.content}>
        <img src={grotDiscouragedSvg} alt="" className={styles.image} />
        <p className={styles.message}>
          Sadly you do not have access to Interactive learning yet as we are under public preview. If you would like to
          be granted access please reach out to your Grafana representative.
        </p>
        <Button variant="secondary" onClick={handleDismiss}>
          Dismiss
        </Button>
      </div>
    </Modal>
  );
}

/**
 * Mount the control group popup into a standalone React root on document.body.
 * Cleans up after dismiss.
 */
export function showControlGroupDocPopup(): void {
  const container = document.createElement('div');
  container.setAttribute('data-testid', 'control-group-doc-popup-container');
  document.body.appendChild(container);

  const root = createRoot(container);

  const cleanup = () => {
    root.unmount();
    container.remove();
  };

  root.render(<ControlGroupDocPopup onDismiss={cleanup} />);

  reportAppInteraction(UserInteraction.NoAccess, {
    source: 'url_param',
  });
}
