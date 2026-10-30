import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { LearningContentCard } from './LearningContentCard';
import { cache } from '@emotion/css';
import { createTheme } from '@grafana/data';
import { getLearningContentCardStyles } from './learning-content-card.styles';
import { getLearningTopicVisual } from './learning-topic-visual';
import { getCompletionPanelStyles } from '../completion-panel/completion-panel.styles';

jest.mock('@grafana/ui', () => {
  const actual = jest.requireActual('@grafana/ui');
  return {
    ...actual,
    Button: React.forwardRef<HTMLButtonElement, React.ComponentProps<typeof actual.Button>>(
      function Button(props, ref) {
        return <actual.Button {...props} ref={ref} data-button-variant={props.variant ?? 'primary'} />;
      }
    ),
  };
});

it('reserves primary emphasis for the featured launch rather than ordinary recommendations', () => {
  render(
    <>
      <LearningContentCard title="Featured" variant="featured" kind="guide" onLaunch={jest.fn()} />
      <LearningContentCard title="Another guide" kind="guide" onLaunch={jest.fn()} />
      <LearningContentCard title="A path" kind="path" onLaunch={jest.fn()} />
      <LearningContentCard title="Documentation" kind="docs" onLaunch={jest.fn()} />
    </>
  );
  const launches = screen.getAllByRole('button');
  expect(launches.filter((button) => button.dataset.buttonVariant === 'primary')).toHaveLength(1);
  expect(launches[0]).toHaveAttribute('data-button-variant', 'primary');
  launches.slice(1).forEach((button) => expect(button).toHaveAttribute('data-button-variant', 'secondary'));
});

jest.mock('@grafana/i18n', () => ({
  t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values?.[key] ?? '')),
}));

describe.each([getLearningContentCardStyles, getCompletionPanelStyles])('featured surfaces', (getStyles) => {
  it.each(['dark', 'light'] as const)('uses semantic container and accent tokens for %s cards', (mode) => {
    const theme = createTheme({ colors: { mode } });
    theme.shape.radius.lg = '11px';
    theme.colors.accent.border = '#f59e4b';
    theme.colors.accent.background = '#714015';
    const styles = getStyles(theme);
    expect(cache.registered[styles.featured]).toContain('border-radius:11px');
    expect(cache.registered[styles.featured]).toContain('#f59e4b');
    expect(cache.registered[styles.featured]).toContain(
      `background:linear-gradient(120deg, #714015, ${theme.colors.background.secondary})`
    );
  });

  it.each([
    ['dark', false],
    ['light', false],
    ['dark', true],
    ['light', true],
  ] as const)('uses host card surfaces in %s mode with visual refresh=%s', (mode, enabled) => {
    const theme = createTheme({ colors: { mode } });
    theme.flags.visualDesignRefresh = enabled;
    theme.colors.background.primary = '#123456';
    theme.colors.background.secondary = '#654321';
    const styles = getStyles(theme);
    if (enabled) {
      expect(cache.registered[styles.featured]).toContain('background:#123456');
      expect(cache.registered[styles.featured]).not.toContain('linear-gradient');
    } else {
      expect(cache.registered[styles.featured]).toContain(
        `background:linear-gradient(120deg, ${theme.colors.accent.background}, #654321)`
      );
    }
    expect(cache.registered[styles.featured]).toContain(theme.colors.accent.border);
  });

  it.each(['dark', 'light'] as const)('renders featured cards without accent tokens in %s mode', (mode) => {
    const theme = createTheme({ colors: { mode } });
    Reflect.deleteProperty(theme.colors, 'accent');
    Reflect.deleteProperty(theme.colors.primary, 'background');
    const styles = getStyles(theme);
    expect(cache.registered[styles.featured]).toContain(theme.colors.primary.border);
    expect(cache.registered[styles.featured]).toContain(
      `background:linear-gradient(120deg, ${theme.colors.primary.transparent}, ${theme.colors.background.secondary})`
    );
    expect(cache.registered[styles.featured]).not.toContain('undefined');
  });
});

it('uses host card surfaces and radius for ordinary cards', () => {
  const theme = createTheme();
  theme.shape.radius.lg = '11px';
  for (const enabled of [false, true]) {
    theme.flags.visualDesignRefresh = enabled;
    const styles = getLearningContentCardStyles(theme);
    expect(cache.registered[styles.card]).toContain('border-radius:11px');
    expect(cache.registered[styles.card]).toContain(`background:${theme.colors.background.primary}`);
  }
});

it('leaves launch button height and padding to the Grafana Button component', () => {
  const styles = getLearningContentCardStyles(createTheme());
  expect(cache.registered[styles.action]).not.toMatch(/(?:height|padding):/);
});

it.each(['dark', 'light'] as const)('uses info tokens for unclassified card icons in %s mode', (mode) => {
  const theme = createTheme({ colors: { mode } });
  theme.colors.info.text = '#346acc';
  theme.colors.info.background = '#dae6ff';
  theme.colors.info.border = '#96b9fa';
  const visual = getLearningTopicVisual(undefined, theme);
  expect(visual.color).toBe(theme.colors.info.text);
  expect(visual.background).toBe(theme.colors.info.background);
  expect(visual.border).toBe(theme.colors.info.border);
});

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

it('lets a featured description that exceeds four lines expand and collapse', () => {
  const measurement = jest.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => 120);
  const getStyle = window.getComputedStyle.bind(window);
  const typography = jest.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const style = getStyle(element, pseudo);
    if (element.tagName === 'P') {
      style.lineHeight = '18px';
      style.fontSize = '13px';
    }
    return style;
  });
  try {
    render(
      <LearningContentCard
        title="A starter path"
        kind="path"
        variant="featured"
        expandableDescription
        onLaunch={jest.fn()}
        description="A very long overview that runs well past the four lines the featured card shows."
      />
    );
    const toggle = screen.getByRole('button', { name: 'Read more' });
    expect(screen.getByText(/A very long overview/)).toHaveStyle({ WebkitLineClamp: '4' });
    fireEvent.click(toggle);
    expect(screen.getByText(/A very long overview/)).not.toHaveStyle({ WebkitLineClamp: '4' });
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
    expect(screen.getByRole('button', { name: 'Read more' })).toHaveAttribute('aria-expanded', 'false');
  } finally {
    measurement.mockRestore();
    typography.mockRestore();
  }
});

it('offers no summary toggle on a featured card unless it opts in to expanding', () => {
  const measurement = jest.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => 120);
  const getStyle = window.getComputedStyle.bind(window);
  const typography = jest.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const style = getStyle(element, pseudo);
    if (element.tagName === 'P') {
      style.lineHeight = '18px';
      style.fontSize = '13px';
    }
    return style;
  });
  try {
    render(
      <LearningContentCard
        title="A starter path"
        kind="path"
        variant="featured"
        onLaunch={jest.fn()}
        details={<p>Module link</p>}
        description="A very long overview that runs well past the four lines the featured card shows."
      />
    );
    expect(screen.queryByRole('button', { name: 'Read more' })).not.toBeInTheDocument();
    expect(screen.getByText(/A very long overview/)).not.toHaveStyle({ WebkitLineClamp: '4' });
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByText('Module link')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show less' })).not.toBeInTheDocument();
  } finally {
    measurement.mockRestore();
    typography.mockRestore();
  }
});

it('keeps the featured primary action last, after the toggle and the details, when it sits at the bottom', () => {
  const { rerender } = render(
    <LearningContentCard
      title="A starter path"
      kind="path"
      variant="featured"
      actionAtBottom
      expanded
      onToggleDetails={jest.fn()}
      details={<p>Module link</p>}
      effort="3 modules"
      onLaunch={jest.fn()}
    />
  );
  const follows = (before: HTMLElement, after: HTMLElement) =>
    Boolean(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING);
  const start = screen.getByRole('button', { name: 'Start path' });
  expect(follows(screen.getByRole('button', { name: 'Hide details' }), screen.getByText('Module link'))).toBe(true);
  expect(follows(screen.getByText('Module link'), start)).toBe(true);
  expect(follows(screen.getByText('3 modules'), start)).toBe(true);

  rerender(
    <LearningContentCard
      title="A starter path"
      kind="path"
      variant="featured"
      expanded
      onToggleDetails={jest.fn()}
      details={<p>Module link</p>}
      effort="3 modules"
      onLaunch={jest.fn()}
    />
  );
  expect(
    follows(screen.getByRole('button', { name: 'Start path' }), screen.getByRole('button', { name: 'Hide details' }))
  ).toBe(true);
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
      effort="3 milestones · About 25 min"
      progress={40}
      onLaunch={onLaunch}
      actionRef={actionRef}
      details={<p>Connect your first data source</p>}
      disclosureLabel="Show milestones"
      collapseLabel="Hide milestones"
    />
  );
  expect(screen.getByRole('heading', { name: 'Getting started' })).toBeInTheDocument();
  expect(screen.getByText('3 milestones · About 25 min')).toBeInTheDocument();
  expect(actionRef.current).toBe(screen.getByRole('button', { name: 'Resume' }));
  fireEvent.click(screen.getByRole('button', { name: 'Show milestones' }));
  expect(screen.getByText('Connect your first data source')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Hide milestones' })).toHaveAttribute('aria-expanded', 'true');
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

it('uses contextual featured copy without changing the default starter wording', () => {
  const { rerender } = render(
    <LearningContentCard
      title="Next dashboard"
      kind="guide"
      variant="featured"
      eyebrow="More on dashboards"
      onLaunch={jest.fn()}
    />
  );
  expect(screen.getByText('More on dashboards')).toBeInTheDocument();
  expect(screen.queryByText('A good place to start')).not.toBeInTheDocument();
  rerender(<LearningContentCard title="Starter path" kind="path" variant="featured" onLaunch={jest.fn()} />);
  expect(screen.getByText('A good place to start')).toBeInTheDocument();
});

it.each(['completion-primary', 'completion-alternative'] as const)(
  'shows the full completion description and a footer launch action in %s',
  (variant) => {
    const measurement = jest.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1000);
    try {
      render(
        <LearningContentCard
          title="Next path"
          kind="path"
          variant={variant}
          eyebrow="Recommended learning"
          description="Understand Grafana concepts, then connect data and build a dashboard."
          effort="Learning path · 6 milestones"
          onLaunch={jest.fn()}
        />
      );
      expect(screen.getByText('Recommended learning')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Read more' })).not.toBeInTheDocument();
      const action = screen.getByRole('button', { name: 'Start path' });
      expect(action.parentElement).toContainElement(screen.getByText('Learning path · 6 milestones'));
    } finally {
      measurement.mockRestore();
    }
  }
);

it('keeps visible completion verbs short while naming their destination accessibly', () => {
  render(
    <LearningContentCard
      title="Next guide"
      kind="guide"
      variant="completion-primary"
      actionLabel="Start"
      actionAriaLabel="Start Next guide"
      onLaunch={jest.fn()}
    />
  );
  expect(screen.getByRole('button', { name: 'Start Next guide' })).toHaveTextContent('Start');
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

it('opens tile path details by clicking the card without a separate launch button', () => {
  const launch = jest.fn();
  const view = jest.fn();
  render(
    <LearningContentCard
      tile
      title="Explore metrics"
      kind="path"
      onLaunch={launch}
      onViewPath={view}
      details={<p>Guide sequence</p>}
    />
  );
  expect(screen.queryByRole('button', { name: 'Start path' })).not.toBeInTheDocument();
  expect(launch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('article'));
  expect(view).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Explore metrics' }));
  expect(view).toHaveBeenCalledTimes(2);
  expect(screen.queryByText('Guide sequence')).not.toBeInTheDocument();
  expect(launch).not.toHaveBeenCalled();
});

it('keeps zero-percent radial progress and metadata on unstarted catalogue path tiles', () => {
  render(
    <LearningContentCard
      tile
      title="A new path"
      kind="path"
      topic="dashboards"
      description="Path description"
      effort="7 guides · About 20 min"
      progress={0}
      onLaunch={jest.fn()}
      onViewPath={jest.fn()}
    />
  );
  expect(screen.getByText('0%')).toBeInTheDocument();
  expect(screen.getByText('Learning path')).toBeInTheDocument();
  expect(screen.queryByText('Dashboards')).not.toBeInTheDocument();
  expect(screen.getByText('7 guides · About 20 min')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Start path' })).not.toBeInTheDocument();
});

it('shows partial guide completion with the same radial used by path tiles', () => {
  render(
    <LearningContentCard
      tile
      title="A started guide"
      kind="guide"
      progress={16}
      effort="About 10 min"
      onLaunch={jest.fn()}
      onViewPath={jest.fn()}
    />
  );
  expect(screen.getByText('16%')).toBeInTheDocument();
  expect(screen.queryByText('16% complete')).not.toBeInTheDocument();
  expect(screen.getByText('About 10 min')).toBeInTheDocument();
});
