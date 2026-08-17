import { NavigationManager } from './navigation-manager';
import * as domUtils from '../lib/dom';

jest.mock('../lib/dom');

class MockResizeObserver {
  observe = jest.fn();
  unobserve = jest.fn();
  disconnect = jest.fn();
}
global.ResizeObserver = MockResizeObserver as any;

const mockIsElementVisible = domUtils.isElementVisible as jest.MockedFunction<typeof domUtils.isElementVisible>;
const mockDescribeElement = domUtils.describeElement as jest.MockedFunction<typeof domUtils.describeElement>;
const mockGetScrollParent = domUtils.getScrollParent as jest.MockedFunction<typeof domUtils.getScrollParent>;
const mockGetVisibleHighlightTarget = domUtils.getVisibleHighlightTarget as jest.MockedFunction<
  typeof domUtils.getVisibleHighlightTarget
>;
const mockIsPathfinderContent = domUtils.isPathfinderContent as jest.MockedFunction<
  typeof domUtils.isPathfinderContent
>;

const stepInfo = (current: number, total: number, completedSteps: number[] = []) => ({
  current,
  total,
  completedSteps,
});

function commentBox(): HTMLElement {
  return document.querySelector('.interactive-comment-box')!;
}

function navButtons(): HTMLButtonElement[] {
  return Array.from(commentBox().querySelectorAll('.interactive-comment-nav-btn'));
}

function buttonLabelled(text: string): HTMLButtonElement | undefined {
  return navButtons().find((button) => button.textContent === text);
}

describe('comment box tour chrome', () => {
  let navigationManager: NavigationManager;
  let target: HTMLElement;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDescribeElement.mockReturnValue('div');
    mockIsElementVisible.mockReturnValue(true);
    mockGetScrollParent.mockReturnValue(document.documentElement);
    mockGetVisibleHighlightTarget.mockImplementation((el) => el);
    mockIsPathfinderContent.mockReturnValue(false);

    navigationManager = new NavigationManager();

    target = document.createElement('div');
    target.scrollIntoView = jest.fn();
    target.getBoundingClientRect = jest.fn().mockReturnValue({
      top: 100,
      left: 100,
      bottom: 200,
      right: 200,
      width: 100,
      height: 100,
    });
    document.body.appendChild(target);
  });

  afterEach(() => {
    navigationManager.clearAllHighlights();
    target.remove();
  });

  const highlight = (
    opts: {
      current?: number;
      total?: number;
      completedSteps?: number[];
      onNext?: () => void;
      onPrevious?: () => void;
      onCancel?: () => void;
      onSkip?: () => void;
      nextLabel?: string;
      showKeyboardHint?: boolean;
    } = {}
  ) =>
    navigationManager.highlightWithComment(
      target,
      'step copy',
      false,
      stepInfo(opts.current ?? 0, opts.total ?? 3, opts.completedSteps),
      opts.onSkip,
      opts.onCancel ?? jest.fn(),
      'onNext' in opts ? opts.onNext : jest.fn(),
      opts.onPrevious,
      { nextLabel: opts.nextLabel, showKeyboardHint: opts.showKeyboardHint }
    );

  describe('navigation buttons', () => {
    it('renders Back and Next when both tour callbacks are supplied', async () => {
      await highlight({ onNext: jest.fn(), onPrevious: jest.fn() });

      expect(buttonLabelled('← Back')).toBeDefined();
      expect(buttonLabelled('Next →')).toBeDefined();
    });

    it('disables Back when no previous callback is supplied', async () => {
      await highlight({ onPrevious: undefined });

      expect(buttonLabelled('← Back')!.disabled).toBe(true);
    });

    it('enables Back when a previous callback is supplied', async () => {
      await highlight({ onPrevious: jest.fn() });

      expect(buttonLabelled('← Back')!.disabled).toBe(false);
    });

    it('invokes the matching callback on click', async () => {
      const onNext = jest.fn();
      const onPrevious = jest.fn();
      await highlight({ onNext, onPrevious });

      buttonLabelled('Next →')!.click();
      buttonLabelled('← Back')!.click();

      expect(onNext).toHaveBeenCalledTimes(1);
      expect(onPrevious).toHaveBeenCalledTimes(1);
    });
  });

  describe('next label', () => {
    it('falls back to Done on the last step', async () => {
      await highlight({ current: 2, total: 3 });

      expect(buttonLabelled('Done')).toBeDefined();
      expect(buttonLabelled('Done')!.getAttribute('aria-label')).toBe('Done');
    });

    it('honours an explicit label on the last step', async () => {
      await highlight({ current: 2, total: 3, nextLabel: 'Start creating' });

      expect(buttonLabelled('Start creating')).toBeDefined();
      expect(buttonLabelled('Done')).toBeUndefined();
    });

    it('honours an explicit label mid-tour, keeping the generic aria-label', async () => {
      await highlight({ current: 1, total: 3, nextLabel: 'Open the guide' });

      const next = buttonLabelled('Open the guide')!;
      expect(next).toBeDefined();
      expect(next.getAttribute('aria-label')).toBe('Next step');
    });

    it('renders Next on a non-final step when no label is supplied', async () => {
      await highlight({ current: 1, total: 3 });

      expect(buttonLabelled('Next →')).toBeDefined();
    });
  });

  describe('progress chrome', () => {
    it('reads the step badge from stepInfo', async () => {
      await highlight({ current: 1, total: 5 });

      expect(commentBox().querySelector('.interactive-comment-step-badge')!.textContent).toBe('Step 2 of 5');
    });

    it('marks the current and completed dots', async () => {
      await highlight({ current: 2, total: 4, completedSteps: [0, 1] });

      const dots = Array.from(commentBox().querySelectorAll('.interactive-comment-dot'));
      expect(dots).toHaveLength(4);
      expect(dots[0]!.classList.contains('interactive-comment-dot--completed')).toBe(true);
      expect(dots[1]!.classList.contains('interactive-comment-dot--completed')).toBe(true);
      expect(dots[2]!.classList.contains('interactive-comment-dot--current')).toBe(true);
      expect(dots[3]!.classList.contains('interactive-comment-dot--current')).toBe(false);
    });

    it('renders the keyboard hint only when asked', async () => {
      await highlight({ showKeyboardHint: true });
      expect(commentBox().querySelector('.interactive-comment-keyboard-hint')).not.toBeNull();

      navigationManager.clearAllHighlights();

      await highlight({ showKeyboardHint: false });
      expect(commentBox().querySelector('.interactive-comment-keyboard-hint')).toBeNull();
    });
  });

  describe('guided mode is unaffected', () => {
    it('renders Cancel and Skip, and no tour buttons, when only guided callbacks are supplied', async () => {
      await navigationManager.highlightWithComment(
        target,
        'guided copy',
        false,
        stepInfo(0, 3),
        jest.fn(),
        jest.fn(),
        undefined,
        undefined
      );

      expect(buttonLabelled('Cancel')).toBeDefined();
      expect(buttonLabelled('Skip →')).toBeDefined();
      expect(buttonLabelled('← Back')).toBeUndefined();
      expect(buttonLabelled('Next →')).toBeUndefined();
    });
  });

  describe('showCenteredComment', () => {
    it('keeps the navigation footer and centres without inline coordinates', () => {
      const onNext = jest.fn();
      navigationManager.showCenteredComment('missing target copy', stepInfo(1, 4), jest.fn(), onNext, jest.fn());

      const box = commentBox();
      expect(box.getAttribute('data-position')).toBe('center');
      expect(box.style.top).toBe('');
      expect(box.style.left).toBe('');
      expect(buttonLabelled('Next →')).toBeDefined();
      expect(buttonLabelled('← Back')).toBeDefined();

      buttonLabelled('Next →')!.click();
      expect(onNext).toHaveBeenCalledTimes(1);
    });
  });

  describe('showNoopComment stays a distinct shape', () => {
    it('renders no footer and keeps its noop marker', () => {
      navigationManager.showNoopComment('noop copy');

      const box = commentBox();
      expect(box.getAttribute('data-noop')).toBe('true');
      expect(box.getAttribute('data-position')).toBe('center');
      expect(navButtons()).toHaveLength(0);
    });
  });

  describe('in-panel highlights are exempt from the floating-panel dodge', () => {
    it('marks both the outline and the comment box when the target is inside the panel', async () => {
      mockIsPathfinderContent.mockReturnValue(true);
      await highlight();

      expect(document.querySelector('.interactive-highlight-outline')!.hasAttribute('data-pathfinder-internal')).toBe(
        true
      );
      expect(commentBox().hasAttribute('data-pathfinder-internal')).toBe(true);
    });

    it('leaves ordinary targets unmarked', async () => {
      await highlight();

      expect(document.querySelector('.interactive-highlight-outline')!.hasAttribute('data-pathfinder-internal')).toBe(
        false
      );
      expect(commentBox().hasAttribute('data-pathfinder-internal')).toBe(false);
    });
  });
});
