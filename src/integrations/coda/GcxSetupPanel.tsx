/**
 * The mint-or-paste form for giving a sandbox VM a gcx credential. Presentation
 * only — the flow is `useGcxCredential`. Test ids come in as a prop because the
 * step keys them by step id and the toolbar has no step id.
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
  tokenLifetime: string;
  install: string;
  error: string;
  skip?: string;
}

export interface GcxSetupPanelProps {
  state: GcxState;
  error: string | null;
  /** Whether a mint has yet to be tried or refused for this session. */
  offerMint: boolean;
  /** Whether Grafana is likely to allow it — how prominently to offer it. */
  mintLikely: boolean;
  onMint: () => void;
  onInstall: (token: string) => void;
  /** Omit where dismissing is the way out, as in a modal. */
  onSkip?: () => void;
  skipLabel?: string;
  testIds: GcxPanelTestIds;
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

export function GcxSetupPanel({
  state,
  error,
  offerMint,
  mintLikely,
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
        role.
      </span>

      {offerMint && (
        <div className={styles.row}>
          <Button size="sm" variant={mintLikely ? 'primary' : 'secondary'} onClick={onMint} data-testid={testIds.mint}>
            Set up gcx
          </Button>
          <span className={styles.hint}>Mints a short-lived token that expires on its own.</span>
        </div>
      )}

      <span className={styles.hint}>
        {mintLikely
          ? 'Or paste a service account token — Administration → Service accounts.'
          : 'Minting usually needs an admin. Paste a Grafana service account token instead — Administration → Service accounts.'}
      </span>

      {/* Only a minted token's lifetime is ours to set. A pasted one is
          forwarded unchanged, so nothing here can bound it. */}
      <span className={styles.warning} data-testid={testIds.tokenLifetime}>
        Give a pasted token an expiry when you create it. Pathfinder cannot shorten or revoke one, so a token with no
        expiry stays valid long after this sandbox is gone.
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
          onClick={() => {
            onInstall(pastedToken.trim());
            setPastedToken('');
          }}
          data-testid={testIds.install}
        >
          Install
        </Button>
      </div>

      {onSkip && (
        <div className={styles.row}>
          <Button size="sm" variant="secondary" fill="text" onClick={onSkip} data-testid={testIds.skip}>
            {skipLabel}
          </Button>
        </div>
      )}
    </div>
  );
}
