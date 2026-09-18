/**
 * The shared gcx form. Presentation only — the flow is in
 * `useGcxCredential.hook.ts` and tested there.
 *
 * The load-bearing assertion is that the paste field is *always* present:
 * minting needs `serviceaccounts:create`, an Admin permission by default, while
 * sandbox sessions are open to Editors, so a mint-only form would reach a
 * fraction of the people who can open a terminal.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

import { GcxReadyLine, GcxSetupPanel } from './GcxSetupPanel';

jest.mock('@grafana/ui', () => ({
  Button: ({ children, onClick, disabled, ...rest }: any) => (
    <button onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  ),
  Icon: ({ name }: any) => <span data-testid={`icon-${name}`} />,
  Input: ({ onChange, value, ...rest }: any) => <input onChange={onChange} value={value} {...rest} />,
  useStyles2: () => new Proxy({}, { get: () => '' }),
}));

const IDS = {
  mint: 'mint',
  tokenInput: 'token',
  tokenLifetime: 'lifetime',
  install: 'install',
  error: 'error',
  skip: 'skip',
};

function renderPanel(props: Partial<React.ComponentProps<typeof GcxSetupPanel>> = {}) {
  const onMint = jest.fn();
  const onInstall = jest.fn();
  const onSkip = jest.fn();
  render(
    <GcxSetupPanel
      state="idle"
      error={null}
      offerMint
      mintLikely
      onMint={onMint}
      onInstall={onInstall}
      onSkip={onSkip}
      testIds={IDS}
      {...props}
    />
  );
  return { onMint, onInstall, onSkip };
}

describe('GcxSetupPanel', () => {
  it('always offers the paste field, even when minting is available', () => {
    renderPanel();
    expect(screen.getByTestId('mint')).toBeInTheDocument();
    expect(screen.getByTestId('token')).toBeInTheDocument();
  });

  it('still offers minting when Grafana is unlikely to allow it, and says so', () => {
    // `canMintGrafanaToken` is a role hint, not an authorisation answer: RBAC
    // can grant `serviceaccounts:create` without the Admin basic role, so
    // hiding the button entirely locks those users out of a path they have.
    renderPanel({ mintLikely: false });
    expect(screen.getByTestId('mint')).toBeInTheDocument();
    expect(screen.getByTestId('token')).toBeInTheDocument();
    expect(screen.getByText(/usually needs an admin/i)).toBeInTheDocument();
  });

  it('stops offering to mint once one has been tried or refused', () => {
    renderPanel({ offerMint: false, state: 'needs-token' });
    expect(screen.queryByTestId('mint')).not.toBeInTheDocument();
    expect(screen.getByTestId('token')).toBeInTheDocument();
  });

  it('clears the pasted token once it has been handed over', () => {
    const { onInstall } = renderPanel();
    fireEvent.change(screen.getByTestId('token'), { target: { value: 'glsa_secret' } });
    fireEvent.click(screen.getByTestId('install'));
    expect(onInstall).toHaveBeenCalledWith('glsa_secret');
    expect(screen.getByTestId('token')).toHaveValue('');
  });

  it('warns that the token is readable inside the VM', () => {
    // The learner has a root shell on the same box; this is an accepted risk
    // that has to be stated, not hidden.
    renderPanel();
    expect(screen.getByText(/readable inside the VM/i)).toBeInTheDocument();
  });

  it('claims a bounded lifetime only for the token it mints', () => {
    // A pasted token is forwarded unchanged, and nothing here can shorten or
    // revoke it — so the exposure the mint path bounds is not bounded there.
    renderPanel();

    expect(screen.getByText(/expires on its own/i)).toBeInTheDocument();
    expect(screen.getByTestId('lifetime').textContent).toMatch(/expiry when you create it/i);
    expect(screen.getByText(/readable inside the VM/i).textContent).not.toMatch(/expires/i);
  });

  it('keeps the pasted-token warning up once minting has been refused', () => {
    renderPanel({ state: 'needs-token', offerMint: false, error: 'no' });

    expect(screen.queryByText(/expires on its own/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('lifetime')).toBeInTheDocument();
  });

  it('claims the role cap only for the token it mints', () => {
    // The cap is Grafana's guard on *creating* an account, so it says nothing
    // about a token the learner pasted: that one carries its own service
    // account's role, and a pasted Admin token stays Admin.
    renderPanel();

    expect(screen.getByText(/capped at your own Grafana role/i)).toBeInTheDocument();
    expect(screen.getByTestId('lifetime').textContent).toMatch(/keeps its own service account/i);
    expect(screen.getByTestId('lifetime').textContent).toMatch(/least privilege/i);
    expect(screen.getByText(/readable inside the VM/i).textContent).not.toMatch(/role/i);
  });

  it('makes no role claim at all once minting has been refused', () => {
    // With the mint gone, the paste path is the only one left — so a role cap
    // would be a claim about a token nothing here can inspect.
    renderPanel({ state: 'needs-token', offerMint: false, error: 'no' });

    expect(screen.queryByText(/capped at your own Grafana role/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('lifetime').textContent).toMatch(/keeps its own service account/i);
  });

  it('trims the pasted token before installing, and will not install an empty one', () => {
    const { onInstall } = renderPanel();
    expect(screen.getByTestId('install')).toBeDisabled();

    fireEvent.change(screen.getByTestId('token'), { target: { value: '  glsa_x  ' } });
    fireEvent.click(screen.getByTestId('install'));

    expect(onInstall).toHaveBeenCalledWith('glsa_x');
  });

  it('shows only a spinner while provisioning, with no form to double-submit', () => {
    renderPanel({ state: 'provisioning' });
    expect(screen.getByText(/Setting up gcx/i)).toBeInTheDocument();
    expect(screen.queryByTestId('mint')).not.toBeInTheDocument();
    expect(screen.queryByTestId('token')).not.toBeInTheDocument();
    expect(screen.queryByTestId('install')).not.toBeInTheDocument();
  });

  it('renders an error and keeps the paste path open', () => {
    renderPanel({ state: 'needs-token', error: 'Grafana would not let this account mint a token.', offerMint: false });
    expect(screen.getByTestId('error')).toHaveTextContent('would not let this account mint');
    expect(screen.getByTestId('token')).toBeInTheDocument();
  });

  it('omits the skip button where dismissing is the way out', () => {
    // The modal has no "continue without" — closing it is that. A guide step
    // needs one, or a refusal dead-ends the guide.
    render(
      <GcxSetupPanel
        state="idle"
        error={null}
        offerMint
        mintLikely
        onMint={jest.fn()}
        onInstall={jest.fn()}
        testIds={{ mint: 'mint', tokenInput: 'token', tokenLifetime: 'lifetime', install: 'install', error: 'error' }}
      />
    );
    expect(screen.queryByRole('button', { name: /continue without gcx/i })).not.toBeInTheDocument();
  });

  it('offers the skip on onSkip alone, so a missing test id cannot drop it', () => {
    render(
      <GcxSetupPanel
        state="idle"
        error={null}
        offerMint
        mintLikely
        onMint={jest.fn()}
        onInstall={jest.fn()}
        onSkip={jest.fn()}
        testIds={{ mint: 'mint', tokenInput: 'token', tokenLifetime: 'lifetime', install: 'install', error: 'error' }}
      />
    );
    expect(screen.getByRole('button', { name: /continue without gcx/i })).toBeInTheDocument();
  });

  it('calls onSkip when offered', () => {
    const { onSkip } = renderPanel();
    fireEvent.click(screen.getByTestId('skip'));
    expect(onSkip).toHaveBeenCalled();
  });
});

describe('GcxReadyLine', () => {
  it('names the file, the context and the server', () => {
    render(
      <GcxReadyLine
        credential={{
          path: '/home/ubuntu/.config/gcx/config.yaml',
          contextName: 'coda',
          server: 'https://g.example.com',
        }}
        testId="ready"
      />
    );
    const line = screen.getByTestId('ready');
    expect(line).toHaveTextContent('/home/ubuntu/.config/gcx/config.yaml');
    expect(line).toHaveTextContent('coda');
    expect(line).toHaveTextContent('https://g.example.com');
  });
});
