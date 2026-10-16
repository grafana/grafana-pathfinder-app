import React from 'react';
import { render, screen } from '@testing-library/react';
import { locationService } from '@grafana/runtime';
import { useBooleanFlag } from '../../utils/openfeature';
import { openCatalogBrowser } from '../docs-panel/utils/open-catalog-browser';
import { BrowsePanel } from './BrowsePanel';

jest.mock('../../utils/openfeature', () => ({ useBooleanFlag: jest.fn(() => true) }));
jest.mock('../docs-panel/utils/open-catalog-browser', () => ({ openCatalogBrowser: jest.fn() }));
jest.mock('@grafana/scenes', () => ({ SceneObjectBase: class {} }));
jest.mock('@grafana/runtime', () => ({ locationService: { replace: jest.fn() } }));
jest.mock('@grafana/i18n', () => ({ t: (_key: string, fallback: string) => fallback }));
jest.mock('@grafana/ui', () => ({
  Button: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
}));

it('does not open or redirect a disabled legacy Browse route', () => {
  jest.mocked(useBooleanFlag).mockReturnValue(false);
  const Component = BrowsePanel.Component;
  render(<Component />);
  expect(screen.getByText('Learning exploration is currently unavailable.')).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(openCatalogBrowser).not.toHaveBeenCalled();
  expect(locationService.replace).not.toHaveBeenCalled();
});
