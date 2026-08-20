/**
 * The mint-or-paste form for giving a sandbox VM a gcx credential, and the line
 * that reports the result.
 *
 * Presentation only — the flow is `useGcxCredential`. Shared by the guide's
 * `terminal-connect` step and the terminal panel's toolbar button, which is why
 * it lives in `integrations/` and takes its test ids as a prop: the step keys
 * them by step id and the toolbar has no step id.
 */

import React, { useState } from 'react';
import { Button, Icon, Input, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';

import type { GcxState } from './useGcxCredential.hook';
import type { GcxCredential } from './coda-api';

export interface GcxPanelTestIds {
  mint: string;
  tokenInput: string;
  install: string;
  error: string;
  skip?: string;
}

const getStyles = (theme: GrafanaTheme2) => ({
  panel: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    marginTop: theme.spacing(1),
  }),
  row: css({
    display: 'flex',
    gap: theme.spacing(1),
    alignItems: 'center',
  }),
  hint: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),
  warning: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.warning.text,
  }),
  error: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.error.text,
  }),
  status: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),
  ready: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.success.text,
  }),
});

/**
 * What was written, and where. Separate from the form so each caller can place
 * it — the step keeps it above its own actions, the modal shows it in place of
 * the form.
 */
export function GcxReadyLine({ credential, testId }: { credential: GcxCredential; testId: string }) {
  const styles = useStyles2(getStyles);
  return (
    <div className={styles.ready} data-testid={testId}>
      <Icon name="check" size="sm" />
      <span>
        gcx is ready — written to <code>{credential.path}</code> as context <code>{credential.contextName}</code>,
        pointing at {credential.server}.
      </span>
    </div>
  );
}

export interface GcxSetupPanelProps {
  state: GcxState;
  error: string | null;
  canMint: boolean;
  onMint: () => void;
  onInstall: (token: string) => void;
  /** Omit where dismissing is the way out, as in a modal. */
  onSkip?: () => void;
  skipLabel?: string;
  testIds: GcxPanelTestIds;
}

export function GcxSetupPanel({
  state,
  error,
  canMint,
  onMint,
  onInstall,
  onSkip,
  skipLabel = 'Continue without gcx',
  testIds,
}: GcxSetupPanelProps) {
  const styles = useStyles2(getStyles);
  const [pastedToken, setPastedToken] = useState('');

  if (state === 'provisioning') {
    return (
      <div className={styles.panel}>
        <span className={styles.status}>
          <Icon name="fa fa-spinner" size="sm" /> Setting up gcx…
        </span>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      {error && (
        <span className={styles.error} data-testid={testIds.error}>
          {error}
        </span>
      )}

      <span className={styles.warning}>
        The token is readable inside the VM — you have a root shell on the same box. It is scoped to your own Grafana
        role and expires with the VM.
      </span>

      {canMint && (
        <div className={styles.row}>
          <Button size="sm" variant="primary" onClick={onMint} data-testid={testIds.mint}>
            Set up gcx
          </Button>
        </div>
      )}

      <span className={styles.hint}>
        {canMint
          ? 'Or paste a service account token — Administration → Service accounts.'
          : 'Paste a Grafana service account token — Administration → Service accounts. Minting one here needs an admin.'}
      </span>

      <div className={styles.row}>
        <Input
          value={pastedToken}
          type="password"
          placeholder="glsa_…"
          onChange={(e) => setPastedToken(e.currentTarget.value)}
          data-testid={testIds.tokenInput}
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={pastedToken.trim() === ''}
          onClick={() => onInstall(pastedToken.trim())}
          data-testid={testIds.install}
        >
          Install
        </Button>
      </div>

      {onSkip && testIds.skip && (
        <div className={styles.row}>
          <Button size="sm" variant="secondary" fill="text" onClick={onSkip} data-testid={testIds.skip}>
            {skipLabel}
          </Button>
        </div>
      )}
    </div>
  );
}
