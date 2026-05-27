/**
 * Locks BlockPreview's force-remount on guide clear. Both an exact
 * `contentKey` match AND the wildcard `'*'` must bump `resetKey`;
 * losing the wildcard branch leaves the preview rendering stale
 * interactive state after "Reset all progress" / path reset.
 */

import * as React from 'react';
import { act, render } from '@testing-library/react';

import { BlockPreview } from './BlockPreview';
import { PROGRESS_CONTENT_KEY_WILDCARD } from '../../global-state/progress-events';
import type { JsonGuide } from './types';

// Substitute a probe for ContentRenderer that surfaces its `key` via the
// DOM. Each `key` change causes a new mount → new probe element with a
// fresh mount counter, which we read to assert remount.
let mountCounter = 0;
jest.mock('../content-renderer/content-renderer', () => ({
  __esModule: true,
  ContentRenderer: () => {
    const id = React.useMemo(() => {
      mountCounter += 1;
      return mountCounter;
    }, []);
    return <div data-testid="content-renderer-probe" data-mount-id={id} />;
  },
}));

// Heavy style helpers — no-op so the probe DOM stays compact.
jest.mock('./block-editor.styles', () => ({
  getBlockPreviewStyles: () => ({
    container: '',
    resetActions: '',
    resetButton: '',
    previewContent: '',
  }),
}));
jest.mock('../../styles/content-html.styles', () => ({ journeyContentHtml: () => '' }));
jest.mock('../../styles/interactive.styles', () => ({ getInteractiveStyles: () => '' }));
jest.mock('../../styles/prism.styles', () => ({ getPrismStyles: () => '' }));

// `parseJsonGuide` must succeed on the minimal fixture so BlockPreview
// reaches the ContentRenderer branch (not the error / empty fallback).
jest.mock('../../docs-retrieval', () => ({
  parseJsonGuide: () => ({
    isValid: true,
    rawContent: { html: '<div />', metadata: {} },
    warnings: [],
  }),
}));

jest.mock('@grafana/ui', () => ({
  useStyles2: (factory: () => unknown) => (typeof factory === 'function' ? factory() : factory),
  Alert: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Icon: () => null,
  // `@grafana/runtime`'s LocationService reaches for these at module load.
  createLogger: () => ({ logger: jest.fn() }),
  attachDebugger: jest.fn(),
}));

const GUIDE_ID = 'test-guide';
const PROGRESS_KEY = `block-editor://preview/${GUIDE_ID}`;

const guide: JsonGuide = {
  id: GUIDE_ID,
  title: 'Test guide',
  blocks: [{ type: 'markdown', content: 'hello' }],
};

beforeEach(() => {
  mountCounter = 0;
});

describe('BlockPreview — resetKey remount', () => {
  it('bumps resetKey on a matching kind:guide clear (hasProgress: false)', () => {
    const { getByTestId } = render(<BlockPreview guide={guide} />);
    const initialMountId = getByTestId('content-renderer-probe').getAttribute('data-mount-id');

    act(() => {
      window.dispatchEvent(
        new CustomEvent('pathfinder:progress', {
          detail: { kind: 'guide', contentKey: PROGRESS_KEY, percentage: 0, hasProgress: false },
        })
      );
    });

    const afterMountId = getByTestId('content-renderer-probe').getAttribute('data-mount-id');
    expect(afterMountId).not.toBe(initialMountId);
  });

  it('bumps resetKey on a wildcard clear (contentKey: "*")', () => {
    const { getByTestId } = render(<BlockPreview guide={guide} />);
    const initialMountId = getByTestId('content-renderer-probe').getAttribute('data-mount-id');

    act(() => {
      window.dispatchEvent(
        new CustomEvent('pathfinder:progress', {
          detail: {
            kind: 'guide',
            contentKey: PROGRESS_CONTENT_KEY_WILDCARD,
            percentage: 0,
            hasProgress: false,
          },
        })
      );
    });

    const afterMountId = getByTestId('content-renderer-probe').getAttribute('data-mount-id');
    expect(afterMountId).not.toBe(initialMountId);
  });

  it('does NOT bump resetKey on a clear for a different contentKey', () => {
    const { getByTestId } = render(<BlockPreview guide={guide} />);
    const initialMountId = getByTestId('content-renderer-probe').getAttribute('data-mount-id');

    act(() => {
      window.dispatchEvent(
        new CustomEvent('pathfinder:progress', {
          detail: {
            kind: 'guide',
            contentKey: 'block-editor://preview/some-other-guide',
            percentage: 0,
            hasProgress: false,
          },
        })
      );
    });

    expect(getByTestId('content-renderer-probe').getAttribute('data-mount-id')).toBe(initialMountId);
  });

  it('does NOT bump resetKey on a kind:guide event with hasProgress: true', () => {
    const { getByTestId } = render(<BlockPreview guide={guide} />);
    const initialMountId = getByTestId('content-renderer-probe').getAttribute('data-mount-id');

    act(() => {
      window.dispatchEvent(
        new CustomEvent('pathfinder:progress', {
          detail: { kind: 'guide', contentKey: PROGRESS_KEY, percentage: 50, hasProgress: true },
        })
      );
    });

    expect(getByTestId('content-renderer-probe').getAttribute('data-mount-id')).toBe(initialMountId);
  });

  // Locks the discriminant guard against future re-shuffling: only
  // `kind: 'guide'` clears bump the key. Step / section completions
  // on the unified channel must not trigger the expensive remount.
  it('does NOT bump resetKey on a kind:step event', () => {
    const { getByTestId } = render(<BlockPreview guide={guide} />);
    const initialMountId = getByTestId('content-renderer-probe').getAttribute('data-mount-id');

    act(() => {
      window.dispatchEvent(
        new CustomEvent('pathfinder:progress', {
          detail: { kind: 'step', stepId: 'step-1', sectionId: 'section-a', completed: true, reason: 'manual' },
        })
      );
    });

    expect(getByTestId('content-renderer-probe').getAttribute('data-mount-id')).toBe(initialMountId);
  });

  it('does NOT bump resetKey on a kind:section event', () => {
    const { getByTestId } = render(<BlockPreview guide={guide} />);
    const initialMountId = getByTestId('content-renderer-probe').getAttribute('data-mount-id');

    act(() => {
      window.dispatchEvent(
        new CustomEvent('pathfinder:progress', {
          detail: { kind: 'section', sectionId: 'section-a', completed: true, percentage: 100 },
        })
      );
    });

    expect(getByTestId('content-renderer-probe').getAttribute('data-mount-id')).toBe(initialMountId);
  });
});
