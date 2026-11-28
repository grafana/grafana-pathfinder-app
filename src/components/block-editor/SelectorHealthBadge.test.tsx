import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

import { createTheme } from '@grafana/data';
import { SelectorHealthBadge } from './SelectorHealthBadge';
import { analyzeSelectorString } from '../../lib/dom/selector-generator';

jest.mock('../../lib/dom/selector-generator', () => ({
  ...jest.requireActual('../../lib/dom/selector-generator'),
  analyzeSelectorString: jest.fn(jest.requireActual('../../lib/dom/selector-generator').analyzeSelectorString),
}));

const TEST_COLORS = { success: 'rgb(1, 2, 3)', warning: 'rgb(4, 5, 6)', error: 'rgb(7, 8, 9)' };

function makeTheme(mode: 'light' | 'dark') {
  const base = createTheme({ colors: { mode } });
  return {
    ...base,
    colors: {
      ...base.colors,
      success: { ...base.colors.success, text: TEST_COLORS.success },
      warning: { ...base.colors.warning, text: TEST_COLORS.warning },
      error: { ...base.colors.error, text: TEST_COLORS.error },
    },
  };
}

let mockMode: 'light' | 'dark' = 'dark';

jest.mock('@grafana/ui', () => ({
  ...jest.requireActual('@grafana/ui'),
  useTheme2: () => makeTheme(mockMode),
  Tooltip: ({ content, children }: { content: string; children: React.ReactNode }) => (
    <span data-testid="selector-warnings" title={content}>
      {children}
    </span>
  ),
}));

describe('SelectorHealthBadge', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('shows the generator-derived method and stability score for a data-testid selector', async () => {
    document.body.innerHTML = '<button data-testid="save">Save</button>';

    render(<SelectorHealthBadge reftarget="button[data-testid='save']" />);

    await waitFor(() => expect(screen.getByText('data-testid')).toBeInTheDocument(), { timeout: 2000 });
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('1 match')).toBeInTheDocument();
  });

  it('rates a bare positional selector with a low stability score', async () => {
    document.body.innerHTML = '<button>A</button><button id="second">B</button>';

    render(<SelectorHealthBadge reftarget="button:nth-of-type(2)" />);

    await waitFor(() => expect(screen.getByText('nth-of-type')).toBeInTheDocument(), { timeout: 2000 });
    expect(screen.getByText('20')).toBeInTheDocument();
  });

  it.each([
    ['without a target state', '', true],
    ['with a target state', 'aria-expanded:true', false],
  ])('flags a toggle-shaped selector that does not match on this page %s', async (_label, targetstate, flagged) => {
    render(
      <SelectorHealthBadge reftarget='button[aria-label="Expand row"]' checkTargetState targetstate={targetstate} />
    );

    await waitFor(() => expect(screen.getByText('0 matches')).toBeInTheDocument(), { timeout: 2000 });
    expect(screen.getByTestId('selector-warnings').title.includes('section recovery can reopen it')).toBe(flagged);
  });

  describe('theme colors', () => {
    const dotOf = (container: HTMLElement) => container.querySelector('span[style*="background"]') as HTMLElement;
    const actual = jest.requireActual('../../lib/dom/selector-generator').analyzeSelectorString;

    afterEach(() => {
      (analyzeSelectorString as jest.Mock).mockImplementation(actual);
    });

    it.each(['light', 'dark'] as const)('maps quality and match count to theme tokens in %s mode', async (mode) => {
      mockMode = mode;
      const cases: Array<[string, string, string, string, string]> = [
        ['good', '<button data-testid="x">a</button>', "button[data-testid='x']", '1 match', TEST_COLORS.success],
        ['poor', '<button>A</button><button>B</button>', 'button:nth-of-type(2)', '1 match', TEST_COLORS.error],
      ];
      for (const [, html, target, matchText, dotColor] of cases) {
        document.body.innerHTML = html;
        const { container, unmount } = render(<SelectorHealthBadge reftarget={target} />);
        await waitFor(() => expect(screen.getByText(matchText)).toBeInTheDocument(), { timeout: 2000 });
        expect(dotOf(container)).toHaveStyle({ backgroundColor: dotColor });
        expect(screen.getByText(matchText)).toHaveStyle({ color: TEST_COLORS.success });
        unmount();
      }
    });

    it('uses the medium color for unknown quality and error/warning for zero/multiple matches', async () => {
      (analyzeSelectorString as jest.Mock).mockReturnValue({
        method: 'x',
        stabilityScore: 50,
        quality: 'bogus',
        warnings: [],
        flags: [],
      });

      const zero = render(<SelectorHealthBadge reftarget="button.none" />);
      await waitFor(() => expect(screen.getByText('0 matches')).toBeInTheDocument(), { timeout: 2000 });
      expect(dotOf(zero.container)).toHaveStyle({ backgroundColor: TEST_COLORS.warning });
      expect(screen.getByText('0 matches')).toHaveStyle({ color: TEST_COLORS.error });
      zero.unmount();

      document.body.innerHTML = '<button class="m">a</button><button class="m">b</button>';
      render(<SelectorHealthBadge reftarget="button.m" />);
      await waitFor(() => expect(screen.getByText('2 matches')).toBeInTheDocument(), { timeout: 2000 });
      expect(screen.getByText('2 matches')).toHaveStyle({ color: TEST_COLORS.warning });
    });
  });
});
