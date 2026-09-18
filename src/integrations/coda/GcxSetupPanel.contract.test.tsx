import { readFileSync } from 'fs';
import { join } from 'path';
import React from 'react';
import { render, screen } from '@testing-library/react';

import { testIds } from '../../constants/testIds';
import { GcxSetupPanel, type GcxPanelTestIds } from './GcxSetupPanel';

const panelSource = readFileSync(join(__dirname, 'GcxSetupPanel.tsx'), 'utf-8');

const PANEL_IDS: GcxPanelTestIds = {
  mint: testIds.codaTerminal.gcxMint,
  tokenInput: testIds.codaTerminal.gcxToken,
  tokenLifetime: testIds.codaTerminal.gcxTokenLifetime,
  install: testIds.codaTerminal.gcxInstall,
  error: testIds.codaTerminal.gcxError,
  skip: 'gcx-skip',
};

function renderPanel(overrides: Partial<React.ComponentProps<typeof GcxSetupPanel>> = {}) {
  return render(
    <GcxSetupPanel
      state="idle"
      error={null}
      offerMint
      mintLikely
      onMint={jest.fn()}
      onInstall={jest.fn()}
      testIds={PANEL_IDS}
      {...overrides}
    />
  );
}

describe('gcx credential E2E contract', () => {
  it('keeps the step-scoped test IDs stable', () => {
    expect(testIds.interactive.gcxMintButton('s')).toBe('interactive-gcx-mint-s');
    expect(testIds.interactive.gcxTokenInput('s')).toBe('interactive-gcx-token-s');
    expect(testIds.interactive.gcxTokenLifetime('s')).toBe('interactive-gcx-token-lifetime-s');
    expect(testIds.interactive.gcxInstallButton('s')).toBe('interactive-gcx-install-s');
    expect(testIds.interactive.gcxSkipButton('s')).toBe('interactive-gcx-skip-s');
    expect(testIds.interactive.gcxReady('s')).toBe('interactive-gcx-ready-s');
    expect(testIds.interactive.gcxError('s')).toBe('interactive-gcx-error-s');
  });

  it('keeps the toolbar test IDs stable', () => {
    expect(testIds.codaTerminal.gcxButton).toBe('coda-terminal-gcx');
    expect(testIds.codaTerminal.gcxMint).toBe('coda-terminal-gcx-mint');
    expect(testIds.codaTerminal.gcxToken).toBe('coda-terminal-gcx-token');
    expect(testIds.codaTerminal.gcxTokenLifetime).toBe('coda-terminal-gcx-token-lifetime');
    expect(testIds.codaTerminal.gcxInstall).toBe('coda-terminal-gcx-install');
    expect(testIds.codaTerminal.gcxReady).toBe('coda-terminal-gcx-ready');
    expect(testIds.codaTerminal.gcxRedo).toBe('coda-terminal-gcx-redo');
    expect(testIds.codaTerminal.gcxError).toBe('coda-terminal-gcx-error');
  });

  it('applies every panel test id from the injected map', () => {
    expect(panelSource).toContain('data-testid={testIds.mint}');
    expect(panelSource).toContain('data-testid={testIds.tokenInput}');
    expect(panelSource).toContain('data-testid={testIds.tokenLifetime}');
    expect(panelSource).toContain('data-testid={testIds.install}');
    expect(panelSource).toContain('data-testid={testIds.error}');
    expect(panelSource).toContain('data-testid={testIds.skip}');
  });

  it('shows the paste field and its lifetime warning whenever the form is offered', () => {
    renderPanel();

    expect(screen.getByTestId(PANEL_IDS.tokenInput)).toBeInTheDocument();
    expect(screen.getByTestId(PANEL_IDS.tokenLifetime)).toBeInTheDocument();
    expect(screen.getByTestId(PANEL_IDS.install)).toBeInTheDocument();
  });

  it('hides the mint button once a mint has been refused, and keeps the paste path', () => {
    renderPanel({ state: 'needs-token', offerMint: false, error: 'nope' });

    expect(screen.queryByTestId(PANEL_IDS.mint)).not.toBeInTheDocument();
    expect(screen.getByTestId(PANEL_IDS.error)).toBeInTheDocument();
    expect(screen.getByTestId(PANEL_IDS.tokenInput)).toBeInTheDocument();
    expect(screen.getByTestId(PANEL_IDS.tokenLifetime)).toBeInTheDocument();
  });

  it('renders no form controls while provisioning', () => {
    renderPanel({ state: 'provisioning' });

    expect(screen.queryByTestId(PANEL_IDS.mint)).not.toBeInTheDocument();
    expect(screen.queryByTestId(PANEL_IDS.tokenInput)).not.toBeInTheDocument();
    expect(screen.queryByTestId(PANEL_IDS.install)).not.toBeInTheDocument();
  });

  it('omits the skip control where dismissing is the way out', () => {
    renderPanel({ testIds: { ...PANEL_IDS, skip: undefined } });

    expect(screen.queryByTestId('gcx-skip')).not.toBeInTheDocument();
  });
});
