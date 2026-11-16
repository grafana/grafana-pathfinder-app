import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { KioskPageV2 } from './KioskPageV2';
import { KioskMarkdown } from './KioskMarkdown';
import { resolveKioskImageUrl } from './KioskImage';
import { launchKioskGuide } from './launch-kiosk-guide';
import { KioskCatalogSchema } from '../../types/kiosk-page.schema';
import event from '../../../docs/examples/kiosk/event-v2.json';
import demStory from '../../../docs/examples/kiosk/dem-two-perspectives.json';

jest.mock('./launch-kiosk-guide', () => ({ launchKioskGuide: jest.fn() }));
jest.mock('../../lib/analytics', () => ({ reportAppInteraction: jest.fn(), UserInteraction: {} }));
jest.mock('../../utils/dev-mode', () => ({ isDevModeEnabledGlobal: () => true }));
jest.mock('../interactive-tutorial/datasource-options', () => ({
  filterDatasourcesByType: () => [],
  toDatasourceOptions: () => [],
}));
jest.mock('./KioskTile', () => ({
  KioskTile: ({ rule }: { rule: { title: string } }) => <button>{rule.title}</button>,
}));

it('renders hero imagery and launches the referenced action with the selected mode', () => {
  const catalog = KioskCatalogSchema.parse(event);
  if (catalog.page.version !== 2) {
    throw new Error('Expected v2 fixture');
  }
  const rules = catalog.rules.map((rule) => ({ ...rule, type: rule.type ?? 'guide' }));
  const onLaunch = jest.fn();
  render(
    <KioskPageV2
      page={catalog.page}
      rules={rules}
      mode="presentation"
      onLaunch={onLaunch}
      catalogUrl="https://example.com/catalog/rules.json"
    />
  );
  expect(screen.getByRole('heading', { name: 'Make room for your next idea' })).toBeInTheDocument();
  expect(document.querySelector('img')).toHaveAttribute(
    'src',
    'https://grafana.com/media/interactive-learning/kiosk/dem/v1/dem-overview-warm.png'
  );
  expect(document.querySelector('img')).toHaveAttribute('alt', '');
  fireEvent.click(screen.getByRole('button', { name: 'Start the tour' }));
  expect(launchKioskGuide).toHaveBeenCalledWith(rules[0], 'presentation', onLaunch, undefined, 0);
});
it('keeps HTML literal and rejects unsafe Markdown links', () => {
  const { container } = render(
    <KioskMarkdown
      content={
        '**Bold** and *emphasis*\n\n- First\n- Second\n\n[Safe](https://grafana.com) [Bad](javascript:alert(1))\n\n<img src="x" onerror="alert(1)">'
      }
    />
  );
  expect(screen.getByText('Bold').tagName).toBe('STRONG');
  expect(screen.getAllByRole('listitem')).toHaveLength(2);
  expect(screen.getByRole('link', { name: 'Safe' })).toHaveAttribute('rel', 'noopener noreferrer');
  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
});

it('renders both DEM perspectives in reading order and launches the combined setup', () => {
  const catalog = KioskCatalogSchema.parse(demStory);
  if (catalog.page.version !== 2) {
    throw new Error('Expected v2');
  }
  const rules = catalog.rules.map((rule) => ({ ...rule, type: rule.type ?? 'guide' }));
  const onLaunch = jest.fn();
  render(
    <KioskPageV2
      page={catalog.page}
      rules={rules}
      mode="instance"
      onLaunch={onLaunch}
      catalogUrl="https://example.com/rules.json"
    />
  );
  expect(screen.getAllByRole('heading').map((heading) => heading.textContent)).toEqual([
    'Two perspectives. One complete picture.',
    'Is your website available?',
    'What are visitors experiencing?',
    'Bring both perspectives together',
  ]);
  expect(screen.getAllByRole('img').map((img) => img.getAttribute('src'))).toEqual([
    'https://grafana.com/media/interactive-learning/kiosk/dem/v1/dem-outside.png',
    'https://grafana.com/media/interactive-learning/kiosk/dem/v1/dem-inside.png',
  ]);
  fireEvent.click(screen.getByRole('button', { name: 'Start guided setup' }));
  expect(launchKioskGuide).toHaveBeenLastCalledWith(rules[0], 'instance', onLaunch, undefined, 8);
});
it('keeps relative PR images inside the captured repository and commit', () => {
  const catalog = `https://raw.githubusercontent.com/fork/repo/${'a'.repeat(40)}/kiosk/demo/rules.json`;
  expect(resolveKioskImageUrl('assets/picture.png', catalog)).toBe(catalog.replace('rules.json', 'assets/picture.png'));
  expect(resolveKioskImageUrl('../../../../main/other/image.png', catalog)).toBeUndefined();
  expect(resolveKioskImageUrl('javascript:alert(1)', catalog)).toBeUndefined();
});
