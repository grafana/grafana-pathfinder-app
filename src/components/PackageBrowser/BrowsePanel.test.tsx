import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { locationService } from '@grafana/runtime';
import { useBooleanFlag } from '../../utils/openfeature';
import { openCatalogBrowser } from '../docs-panel/utils/open-catalog-browser';
import { BrowsePanel } from './BrowsePanel';

jest.mock('../../utils/openfeature', () => ({ useBooleanFlag: jest.fn(() => true) }));
jest.mock('../docs-panel/utils/open-catalog-browser', () => ({ openCatalogBrowser: jest.fn() }));
jest.mock('./PackageBrowser', () => ({
  PackageBrowser: ({ page }: { page: boolean }) => (
    <div data-testid="explore-page">{page ? 'Page catalogue' : 'Sidebar catalogue'}</div>
  ),
}));
jest.mock('../docs-panel/utils/open-prepared-guide', () => ({ openGuideInSidebar: jest.fn() }));
jest.mock('@grafana/scenes', () => ({ SceneObjectBase: class {} }));
jest.mock('@grafana/runtime', () => ({ locationService: { replace: jest.fn(), push: jest.fn() } }));
jest.mock('@grafana/i18n', () => ({ t: (_key: string, fallback: string) => fallback }));
jest.mock('@grafana/ui', () => ({
  useStyles2: () => ({}),
  Button: ({ children, onClick }: { children: React.ReactNode; onClick: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
}));

it('does not open or redirect a disabled legacy Browse route', () => {
  jest.mocked(useBooleanFlag).mockReturnValue(false);
  const Component = BrowsePanel.Component;
  render(<Component />);
  expect(screen.getByText('Learning exploration is currently unavailable.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
  expect(openCatalogBrowser).not.toHaveBeenCalled();
  expect(locationService.replace).not.toHaveBeenCalled();
});

it('renders Explore in the page instead of opening the sidebar or redirecting home', () => {
  jest.mocked(useBooleanFlag).mockReturnValue(true);
  const Component = BrowsePanel.Component;
  render(<Component />);
  expect(screen.getByTestId('explore-page')).toHaveTextContent('Page catalogue');
  expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
  expect(openCatalogBrowser).not.toHaveBeenCalled();
  expect(locationService.replace).not.toHaveBeenCalled();
});

it('returns home through Grafana navigation when Back is clicked', () => {
  const Component = BrowsePanel.Component;
  render(<Component />);

  fireEvent.click(screen.getByRole('button', { name: 'Back' }));

  expect(locationService.push).toHaveBeenCalledWith('/a/grafana-pathfinder-app/');
});
