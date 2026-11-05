import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OrganizationGuideEntry } from './OrganizationGuideEntry';
import { resolveOrganizationGuide } from '../../integrations/organization-guide/resolve';
import type { OrganizationGuideEntry as Entry } from './useOrganizationGuide';

jest.mock('../../integrations/organization-guide/resolve', () => ({ resolveOrganizationGuide: jest.fn() }));
const guide = {
  resourceName: 'welcome',
  guideId: 'welcome',
  url: 'backend-guide:welcome',
  title: 'Welcome',
  content: { metadata: { packageManifest: { id: 'welcome' } } },
} as unknown as Entry['guide'];

it.each([
  { progress: 0, completed: false, label: 'Start' },
  { progress: 40, completed: false, label: 'Resume' },
  { progress: 100, completed: true, label: 'Open guide' },
])('offers $label without invoking a progress-reset flow', async ({ progress, completed, label }) => {
  jest.mocked(resolveOrganizationGuide).mockResolvedValue(guide);
  const open = jest.fn();
  render(<OrganizationGuideEntry entry={{ guide, progress, completed }} onOpen={open} />);
  fireEvent.click(screen.getByRole('button', { name: label }));
  await waitFor(() =>
    expect(open).toHaveBeenCalledWith(
      'backend-guide:welcome',
      'Welcome',
      expect.objectContaining({ launchSource: 'organization_guide', repository: 'app-platform' })
    )
  );
  expect(Boolean(screen.queryByText('Completed'))).toBe(completed);
});

it('does not launch an unpublished guide on a stale entry', async () => {
  jest.mocked(resolveOrganizationGuide).mockResolvedValue(null);
  const open = jest.fn();
  render(<OrganizationGuideEntry entry={{ guide, progress: 0, completed: false }} onOpen={open} />);
  fireEvent.click(screen.getByRole('button', { name: 'Start' }));
  await screen.findByText('This organization guide is currently unavailable');
  expect(open).not.toHaveBeenCalled();
});
