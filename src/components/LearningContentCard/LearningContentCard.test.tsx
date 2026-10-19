import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { LearningContentCard } from './LearningContentCard';

jest.mock('@grafana/i18n', () => ({
  t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values?.[key] ?? '')),
}));

it('discloses details without launching, moving focus, or hiding the primary action', () => {
  const onLaunch = jest.fn();
  render(
    <LearningContentCard
      title="Dashboard path"
      kind="path"
      onLaunch={onLaunch}
      details={<button>Module link</button>}
    />
  );
  expect(screen.queryByText('Module link')).not.toBeInTheDocument();
  const toggle = screen.getByRole('button', { name: 'Details' });
  toggle.focus();
  fireEvent.click(toggle);
  expect(toggle).toHaveFocus();
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('button', { name: 'Start path' })).toBeEnabled();
  expect(onLaunch).not.toHaveBeenCalled();
  fireEvent.click(toggle);
  expect(screen.queryByText('Module link')).not.toBeInTheDocument();
});

it('hides zero progress and uses Resume, Review, and Read for the appropriate state', () => {
  const { rerender } = render(<LearningContentCard title="A guide" kind="guide" onLaunch={jest.fn()} progress={0} />);
  expect(screen.queryByText('0% complete')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Details' })).not.toBeInTheDocument();
  rerender(<LearningContentCard title="A guide" kind="guide" onLaunch={jest.fn()} progress={35} />);
  expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
  expect(screen.getByText('35% complete')).toBeInTheDocument();
  rerender(<LearningContentCard title="A guide" kind="guide" onLaunch={jest.fn()} progress={100} />);
  expect(screen.getByRole('button', { name: 'Review' })).toBeInTheDocument();
  expect(screen.getByText('Completed')).toBeInTheDocument();
  rerender(<LearningContentCard title="Documentation" kind="docs" onLaunch={jest.fn()} />);
  expect(screen.getByRole('button', { name: 'Read' })).toBeInTheDocument();
});

it('offers Read more only when the rendered description is truncated', () => {
  let height = 36;
  const measurement = jest.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => height);
  const getStyle = window.getComputedStyle.bind(window);
  const typography = jest.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const style = getStyle(element, pseudo);
    if (element.tagName === 'P') {
      style.lineHeight = '18px';
      style.fontSize = '12px';
    }
    return style;
  });
  try {
    const { rerender } = render(
      <LearningContentCard
        title="A guide"
        kind="guide"
        onLaunch={jest.fn()}
        description="A short overview that fits in the card."
      />
    );
    expect(screen.queryByRole('button', { name: 'Read more' })).not.toBeInTheDocument();
    height = 72;
    rerender(
      <LearningContentCard
        title="A guide"
        kind="guide"
        onLaunch={jest.fn()}
        description="A longer overview that spans several lines within the available card width."
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Read more' }));
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByText('Source: Grafana')).not.toBeInTheDocument();
    rerender(
      <LearningContentCard
        title="A starter path"
        kind="path"
        variant="featured"
        onLaunch={jest.fn()}
        description="A longer overview that spans several lines within the available card width."
      />
    );
    expect(screen.getByText('A good place to start')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Read more' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show less' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start path' })).toBeEnabled();
  } finally {
    measurement.mockRestore();
    typography.mockRestore();
  }
});

it('prevents duplicate launches and keeps failure recovery inside the card', async () => {
  let reject: (error: Error) => void = () => {};
  const onLaunch = jest.fn(
    () =>
      new Promise<void>((_resolve, fail) => {
        reject = fail;
      })
  );
  render(<LearningContentCard title="A guide" kind="guide" onLaunch={onLaunch} />);
  fireEvent.click(screen.getByRole('button', { name: 'Start guide' }));
  fireEvent.click(screen.getByRole('button', { name: 'Opening…' }));
  expect(onLaunch).toHaveBeenCalledTimes(1);
  await act(async () => {
    reject(new Error('private backend detail'));
  });
  expect(screen.getByRole('alert').closest('article')).toBe(screen.getByRole('article'));
  expect(screen.queryByText('private backend detail')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(onLaunch).toHaveBeenCalledTimes(2);
});

it('keeps actual module disclosure, effort and Resume available on the featured starter', () => {
  const onLaunch = jest.fn();
  const actionRef = React.createRef<HTMLButtonElement>();
  render(
    <LearningContentCard
      title="Getting started"
      kind="path"
      variant="featured"
      description="Learn the Grafana essentials."
      effort="3 modules · About 25 min"
      progress={40}
      onLaunch={onLaunch}
      actionRef={actionRef}
      details={<p>Connect your first data source</p>}
      disclosureLabel="Show modules"
      collapseLabel="Hide modules"
    />
  );
  expect(screen.getByRole('heading', { name: 'Getting started' })).toBeInTheDocument();
  expect(screen.getByText('3 modules · About 25 min')).toBeInTheDocument();
  expect(actionRef.current).toBe(screen.getByRole('button', { name: 'Resume' }));
  fireEvent.click(screen.getByRole('button', { name: 'Show modules' }));
  expect(screen.getByText('Connect your first data source')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Hide modules' })).toHaveAttribute('aria-expanded', 'true');
  expect(onLaunch).not.toHaveBeenCalled();
});

it('labels known topics and keeps the leading icon decorative without inventing unknown topics', () => {
  const { rerender } = render(
    <LearningContentCard title="Build a dashboard" kind="guide" topic="dashboards" onLaunch={jest.fn()} />
  );
  expect(screen.getByText('Dashboards')).toBeInTheDocument();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  rerender(<LearningContentCard title="Custom guide" kind="guide" topic="my-private-category" onLaunch={jest.fn()} />);
  expect(screen.queryByText('my-private-category')).not.toBeInTheDocument();
  expect(screen.queryByText('Other topics')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Start guide' })).toBeInTheDocument();
});

it('lets a featured card carry its own eyebrow and badges', () => {
  render(
    <LearningContentCard
      title="A starter path"
      kind="path"
      variant="featured"
      eyebrow="Recommended for you"
      badges={<span>Alerting</span>}
      onLaunch={jest.fn()}
    />
  );

  expect(screen.getByText('Recommended for you')).toBeInTheDocument();
  expect(screen.queryByText('A good place to start')).not.toBeInTheDocument();
  expect(screen.getByText('Alerting')).toBeInTheDocument();
});
