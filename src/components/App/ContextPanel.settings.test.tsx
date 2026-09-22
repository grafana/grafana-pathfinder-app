import React, { useEffect, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { getConfigWithDefaults } from '../../constants';
import { usePathfinderPluginConfig, refreshPathfinderPluginConfig } from '../../hooks';
import { CombinedLearningJourneyPanel } from '../docs-panel/docs-panel';
import MemoizedContextPanel from './ContextPanel';

jest.mock('../../hooks', () => ({
  usePathfinderPluginConfig: jest.fn(),
  refreshPathfinderPluginConfig: jest.fn(),
}));
jest.mock('../OpenFeatureProvider', () => ({
  PathfinderFeatureProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock('../../global-state/panel-mode', () => ({
  panelModeManager: { getMode: () => 'sidebar' },
}));
jest.mock('../docs-panel/docs-panel', () => ({ CombinedLearningJourneyPanel: jest.fn() }));

const hook = jest.mocked(usePathfinderPluginConfig);
const construct = jest.mocked(CombinedLearningJourneyPanel);
const sync = jest.fn();

function Panel({ model }: { model: { syncPluginConfig: typeof sync } }) {
  const { config } = usePathfinderPluginConfig();
  const [draft, setDraft] = useState('loaded content');
  useEffect(() => model.syncPluginConfig(config), [config, model]);
  return <input aria-label="Open tab content" value={draft} onChange={(event) => setDraft(event.target.value)} />;
}

beforeEach(() => {
  jest.clearAllMocks();
  hook.mockReturnValue({ config: getConfigWithDefaults({}), isResolved: false });
  construct.mockImplementation(() => ({ Component: Panel, syncPluginConfig: sync }) as never);
});

it('waits for authoritative settings and preserves the scene and open content on later hydration', () => {
  const { rerender } = render(<MemoizedContextPanel />);
  expect(construct).not.toHaveBeenCalled();
  expect(screen.getByText('Loading Pathfinder settings')).toBeInTheDocument();

  const first = getConfigWithDefaults({ enableLiveSessions: true });
  hook.mockReturnValue({ config: first, isResolved: true });
  rerender(<MemoizedContextPanel />);
  expect(construct).toHaveBeenCalledWith(first);
  fireEvent.change(screen.getByLabelText('Open tab content'), { target: { value: 'unsaved content' } });

  const hydrated = getConfigWithDefaults({ enableLiveSessions: false });
  hook.mockReturnValue({ config: hydrated, isResolved: true });
  rerender(<MemoizedContextPanel />);
  expect(construct).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('Open tab content')).toHaveValue('unsaved content');
  expect(sync).toHaveBeenLastCalledWith(hydrated);
});

it('keeps browsing available during a settings failure and preserves content after recovery', () => {
  hook.mockReturnValue({ config: getConfigWithDefaults({}), isResolved: false, hasError: true });
  const { rerender } = render(<MemoizedContextPanel />);
  expect(screen.getByText('Some learning settings are unavailable')).toBeInTheDocument();
  expect(construct).toHaveBeenCalledWith(getConfigWithDefaults({}));
  fireEvent.change(screen.getByLabelText('Open tab content'), { target: { value: 'unsaved content' } });
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(refreshPathfinderPluginConfig).toHaveBeenCalledTimes(1);

  const recovered = getConfigWithDefaults({ enableLiveSessions: true });
  hook.mockReturnValue({ config: recovered, isResolved: true });
  rerender(<MemoizedContextPanel />);

  expect(screen.queryByText('Some learning settings are unavailable')).not.toBeInTheDocument();
  expect(construct).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('Open tab content')).toHaveValue('unsaved content');
  expect(sync).toHaveBeenLastCalledWith(recovered);
});
