import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { GrotGuideBlock } from './grot-guide-block';
import type { GrotGuideBlockProps } from './grot-guide-block';

// Minimal mock for @grafana/ui
jest.mock('@grafana/ui', () => ({
  ...jest.requireActual('@grafana/ui'),
  useStyles2: (fn: Function) =>
    fn({
      colors: {
        background: { secondary: '#f5f5f5', primary: '#fff' },
        border: { weak: '#ddd', medium: '#bbb' },
        text: { primary: '#333', secondary: '#666', link: '#0066cc', disabled: '#999' },
        action: { hover: '#eee' },
        primary: { main: '#0066cc', border: '#0066cc', transparent: '#e6f0ff' },
      },
      shape: { radius: { default: '4px' } },
      typography: {
        h4: { fontSize: '18px' },
        body: { fontSize: '14px', lineHeight: '1.5' },
        bodySmall: { fontSize: '12px' },
        fontWeightMedium: 500,
        fontFamilyMonospace: 'monospace',
      },
      spacing: (n: number) => `${n * 8}px`,
    }),
}));

const makeProps = (overrides: Partial<GrotGuideBlockProps> = {}): GrotGuideBlockProps => ({
  welcome: {
    title: 'Test Welcome',
    body: 'Welcome body text',
    bodyHtml: '<p>Welcome body text</p>',
    ctas: [{ text: "Let's go!", screenId: 'q1' }],
  },
  screens: [
    {
      type: 'question',
      id: 'q1',
      title: 'Pick a path',
      options: [
        { text: 'Option A', screenId: 'r1' },
        { text: 'Option B', screenId: 'r2' },
      ],
    },
    {
      type: 'result',
      id: 'r1',
      title: 'Result A',
      body: 'You picked A.',
      bodyHtml: '<p>You picked A.</p>',
      links: [{ type: 'docs', title: 'Docs Link', linkText: 'Visit docs', href: 'https://grafana.com/docs/' }],
    },
    {
      type: 'result',
      id: 'r2',
      title: 'Result B',
      body: 'You picked B.',
      bodyHtml: '<p>You picked B.</p>',
    },
  ],
  ...overrides,
});

describe('GrotGuideBlock', () => {
  it('renders the welcome screen by default', () => {
    render(<GrotGuideBlock {...makeProps()} />);
    expect(screen.getByText('Test Welcome')).toBeInTheDocument();
    expect(screen.getByText("Let's go!")).toBeInTheDocument();
  });

  it('navigates to question screen when CTA is clicked', () => {
    render(<GrotGuideBlock {...makeProps()} />);
    fireEvent.click(screen.getByText("Let's go!"));
    expect(screen.getByText('Pick a path')).toBeInTheDocument();
    expect(screen.getByText('Option A')).toBeInTheDocument();
    expect(screen.getByText('Option B')).toBeInTheDocument();
  });

  it('navigates to result screen when option is clicked', () => {
    render(<GrotGuideBlock {...makeProps()} />);
    fireEvent.click(screen.getByText("Let's go!"));
    fireEvent.click(screen.getByText('Option A'));
    expect(screen.getByText('Result A')).toBeInTheDocument();
  });

  it('renders links on result screens', () => {
    render(<GrotGuideBlock {...makeProps()} />);
    fireEvent.click(screen.getByText("Let's go!"));
    fireEvent.click(screen.getByText('Option A'));
    const link = screen.getByText('Visit docs').closest('a');
    expect(link).toHaveAttribute('href', 'https://grafana.com/docs/');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('back button returns to previous screen', () => {
    render(<GrotGuideBlock {...makeProps()} />);
    // Navigate: welcome → question
    fireEvent.click(screen.getByText("Let's go!"));
    expect(screen.getByText('Pick a path')).toBeInTheDocument();

    // Click back
    fireEvent.click(screen.getByText('Back'));
    expect(screen.getByText('Test Welcome')).toBeInTheDocument();
  });

  it('start over returns to welcome from result screen', () => {
    render(<GrotGuideBlock {...makeProps()} />);
    fireEvent.click(screen.getByText("Let's go!"));
    fireEvent.click(screen.getByText('Option B'));
    expect(screen.getByText('Result B')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Start over'));
    expect(screen.getByText('Test Welcome')).toBeInTheDocument();
  });

  it('multi-step back navigation works correctly', () => {
    render(<GrotGuideBlock {...makeProps()} />);
    // Navigate: welcome → question → result
    fireEvent.click(screen.getByText("Let's go!"));
    fireEvent.click(screen.getByText('Option A'));
    expect(screen.getByText('Result A')).toBeInTheDocument();

    // Back to question
    fireEvent.click(screen.getByText('Back'));
    expect(screen.getByText('Pick a path')).toBeInTheDocument();

    // Back to welcome
    fireEvent.click(screen.getByText('Back'));
    expect(screen.getByText('Test Welcome')).toBeInTheDocument();
  });

  it('does not show back button on welcome screen', () => {
    render(<GrotGuideBlock {...makeProps()} />);
    expect(screen.queryByText('Back')).not.toBeInTheDocument();
  });
});
