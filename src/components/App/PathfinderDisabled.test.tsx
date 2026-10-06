import React from 'react';
import { OrgRole } from '@grafana/data';
import { fireEvent, render, screen } from '@testing-library/react';
import { config, locationService } from '@grafana/runtime';
import { PathfinderDisabled } from './PathfinderDisabled';

jest.mock('@grafana/runtime', () => ({
  config: { bootData: { user: { orgRole: 'Admin', isGrafanaAdmin: false } } },
  locationService: { push: jest.fn() },
}));

it('keeps configuration reachable when disabled', () => {
  config.bootData.user.orgRole = OrgRole.Admin;
  render(<PathfinderDisabled />);
  expect(screen.getByText('Interactive learning is disabled')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Open interactive learning settings' }));
  expect(locationService.push).toHaveBeenCalledWith('/plugins/grafana-pathfinder-app?page=configuration');
});

it.each([OrgRole.Viewer, OrgRole.Editor])('does not offer configuration to %s', (role) => {
  config.bootData.user.orgRole = role;
  render(<PathfinderDisabled />);
  expect(screen.queryByRole('button', { name: 'Open interactive learning settings' })).not.toBeInTheDocument();
});

it('offers configuration to a Grafana admin with Viewer org role', () => {
  config.bootData.user.orgRole = OrgRole.Viewer;
  config.bootData.user.isGrafanaAdmin = true;
  render(<PathfinderDisabled />);
  expect(screen.getByRole('button', { name: 'Open interactive learning settings' })).toBeInTheDocument();
  config.bootData.user.isGrafanaAdmin = false;
});
