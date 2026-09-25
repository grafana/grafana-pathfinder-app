import React from 'react';
import { OrgRole } from '@grafana/data';
import { fireEvent, render, screen } from '@testing-library/react';
import { config, locationService } from '@grafana/runtime';
import { PathfinderUnavailable } from './PathfinderUnavailable';

jest.mock('@grafana/runtime', () => ({
  config: { bootData: { user: { orgRole: 'Admin', isGrafanaAdmin: false } } },
  locationService: { push: jest.fn() },
}));

it.each([false, true])('keeps configuration reachable when unavailable=%s', (unavailable) => {
  config.bootData.user.orgRole = OrgRole.Admin;
  render(<PathfinderUnavailable unavailable={unavailable} />);
  expect(screen.getByText(unavailable ? 'Pathfinder is unavailable' : 'Pathfinder is disabled')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Open Pathfinder settings' }));
  expect(locationService.push).toHaveBeenCalledWith('/plugins/grafana-pathfinder-app?page=configuration');
});

it.each([OrgRole.Viewer, OrgRole.Editor])('does not offer configuration to %s', (role) => {
  config.bootData.user.orgRole = role;
  render(<PathfinderUnavailable unavailable={false} />);
  expect(screen.queryByRole('button', { name: 'Open Pathfinder settings' })).not.toBeInTheDocument();
});
