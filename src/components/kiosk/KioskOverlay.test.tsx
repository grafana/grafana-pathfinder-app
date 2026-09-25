import { reportKioskInteraction } from '../../lib/kiosk-analytics';
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { KioskOverlay } from './KioskOverlay';
import { loadKioskData, DEFAULT_BANNER, type KioskData } from './kiosk-rules';

jest.mock('../../lib/kiosk-analytics', () => ({ reportKioskInteraction: jest.fn() }));

jest.mock('@grafana/ui', () => ({
  Icon: () => null,
  Button: React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
    function MockButton(props, ref) {
      return <button {...props} ref={ref} />;
    }
  ),
  useStyles2: () => ({}),
}));
jest.mock('./kiosk-rules', () => ({ loadKioskData: jest.fn(), DEFAULT_BANNER: 'default-banner' }));
jest.mock('./KioskPage', () => ({ KioskPage: () => <div>Structured page</div> }));
jest.mock('./KioskTile', () => ({ KioskTile: ({ rule }: { rule: { title: string } }) => <div>{rule.title}</div> }));

const load = jest.mocked(loadKioskData);
const data = (title: string): KioskData => ({
  banner: '',
  rules: [{ title, url: 'bundled:welcome', description: 'Learn', type: 'guide' }],
});

beforeEach(() => load.mockReset());

it('sanitizes remote banners and displays fallback warnings', async () => {
  load.mockResolvedValue({
    ...data('Default guide'),
    banner:
      '<h2>Welcome</h2><img src="x" onerror="alert(1)"><script>alert(1)</script><a href="javascript:alert(1)">bad link</a>',
    warning: 'Showing the default kiosk.',
  });
  const { container } = render(<KioskOverlay rulesUrl="default" overrideUrl="custom" onClose={jest.fn()} />);
  expect(await screen.findByText('Default guide')).toBeInTheDocument();
  expect(screen.getByText('Showing the default kiosk.')).toBeInTheDocument();
  expect(screen.getByText('Welcome')).toBeInTheDocument();
  expect(document.body.querySelector('script')).toBeNull();
  expect(document.body.querySelector('[onerror]')).toBeNull();
  expect(screen.getByText('bad link')).not.toHaveAttribute('href');
  expect(container).toBeEmptyDOMElement();
});

it('aborts stale selections and ignores their results', async () => {
  let resolveOld!: (result: KioskData) => void;
  load
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        })
    )
    .mockResolvedValueOnce(data('New guide'));
  const { rerender, unmount } = render(<KioskOverlay rulesUrl="default" overrideUrl="old" onClose={jest.fn()} />);
  const firstSignal = load.mock.calls[0]![2]!;
  rerender(<KioskOverlay rulesUrl="default" overrideUrl="new" onClose={jest.fn()} />);
  expect(firstSignal.aborted).toBe(true);
  expect(await screen.findByText('New guide')).toBeInTheDocument();
  await act(async () => resolveOld(data('Old guide')));
  expect(screen.queryByText('Old guide')).toBeNull();
  expect(screen.getByText('New guide')).toBeInTheDocument();
  unmount();
  expect(load.mock.calls[1]![2]!.aborted).toBe(true);
});

it('clears a previous warning and displays loading when switching selection', async () => {
  load.mockResolvedValueOnce({ ...data('First'), warning: 'Old warning' });
  const { rerender } = render(<KioskOverlay rulesUrl="default" overrideUrl="old" onClose={jest.fn()} />);
  await screen.findByText('Old warning');
  let resolveNext!: (result: KioskData) => void;
  load.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveNext = resolve;
      })
  );
  rerender(<KioskOverlay rulesUrl="default" overrideUrl="new" onClose={jest.fn()} />);
  expect(screen.getByText('Loading guides...')).toBeInTheDocument();
  expect(screen.queryByText('Old warning')).toBeNull();
  await act(async () => resolveNext(data('Second')));
  await waitFor(() => expect(screen.getByText('Second')).toBeInTheDocument());
});

it('brands the default banner as Grafana learning material', async () => {
  load.mockResolvedValue({ ...data('A guide'), banner: DEFAULT_BANNER });
  render(<KioskOverlay rulesUrl="" mode="instance" onClose={jest.fn()} />);
  expect(await screen.findByRole('heading', { name: 'Learn Grafana' })).toBeInTheDocument();
  expect(screen.getByText('Grafana learning')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Back to Grafana' })).toBeInTheDocument();
});

it('renders a structured page instead of the legacy banner and grid', async () => {
  load.mockResolvedValue({
    ...data('Legacy guide'),
    banner: '<h2>Legacy banner</h2>',
    page: {
      version: 1,
      header: 'minimal',
      blocks: [{ type: 'hero', title: 'Demo' }],
    },
  });
  render(<KioskOverlay rulesUrl="default" onClose={jest.fn()} />);
  expect(await screen.findByText('Structured page')).toBeVisible();
  expect(screen.queryByText('Legacy banner')).toBeNull();
  expect(screen.queryByText('Legacy guide')).toBeNull();
  expect(screen.queryByText('Interactive guides')).toBeNull();
  expect(screen.getByRole('button', { name: 'Back to Grafana' })).toBeVisible();
});

it.each(['button', 'escape'] as const)('reports a deliberate %s exit', async (method) => {
  jest.mocked(reportKioskInteraction).mockClear();
  load.mockResolvedValue(data('Guide'));
  const onClose = jest.fn();
  render(<KioskOverlay rulesUrl="default" mode="instance" onClose={onClose} />);
  await screen.findByText('Guide');
  const exit = screen.getByRole('button', { name: 'Back to Grafana' });
  if (method === 'button') {
    fireEvent.click(exit);
  } else {
    fireEvent.keyDown(exit, { key: 'Escape' });
  }
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(reportKioskInteraction).toHaveBeenCalledTimes(1);
  expect(reportKioskInteraction).toHaveBeenCalledWith('instance', undefined, {
    component: 'kiosk',
    action: 'exit',
    method,
  });
});
