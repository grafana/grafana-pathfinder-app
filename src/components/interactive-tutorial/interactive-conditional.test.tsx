import React from 'react';
import { createTheme } from '@grafana/data';
import { act, render, screen, waitFor } from '@testing-library/react';

import { testIds } from '../../constants/testIds';
import { getInteractiveStyles } from '../../styles/interactive.styles';
import { InteractiveConditional } from './interactive-conditional';
import { wrapSectionChildrenForNumbering } from './section-numbering';

const checkRequirementsFromData = jest.fn();
const mockActionMonitor = {
  enable: jest.fn(),
  forceEnable: jest.fn(),
};

const ConditionalStepCard = () => <div className="interactive-step">Interactive branch</div>;

function NestedPassiveConditional({ depth, keyPrefix }: { depth: number; keyPrefix: string }) {
  return (
    <InteractiveConditional
      conditions={['nested']}
      whenTrueChildren={[]}
      whenFalseChildren={[{ type: depth === 1 ? 'p' : 'interactive-conditional', props: {}, children: [] }]}
      renderElement={(_element, childKey) =>
        depth === 1 ? (
          <p key={childKey}>Nested passive branch</p>
        ) : (
          <NestedPassiveConditional key={childKey} depth={depth - 1} keyPrefix={`${keyPrefix}-nested`} />
        )
      }
      keyPrefix={keyPrefix}
    />
  );
}

jest.mock('../../interactive-engine', () => ({
  useInteractiveElements: () => ({
    checkRequirementsFromData,
  }),
  ActionMonitor: {
    getInstance: () => mockActionMonitor,
  },
  outcomeFromLoopExit: jest.fn(),
}));

jest.mock('../../requirements-manager', () => ({
  useStepChecker: () => ({ completionReason: undefined }),
  stripTabLocalRequirements: (requirements: string | undefined) => requirements,
}));

jest.mock('../../constants', () => ({
  ...jest.requireActual('../../constants'),
  getConfigWithDefaults: () => ({ disableAutoCollapse: false }),
}));

describe('InteractiveConditional', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    checkRequirementsFromData.mockReset();
    checkRequirementsFromData.mockResolvedValue({ pass: false, requirements: '', error: [] });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const renderConditional = (pass: boolean) => {
    checkRequirementsFromData.mockResolvedValue({ pass, requirements: '', error: [] });
    return render(
      <InteractiveConditional
        conditions={['exists-reftarget']}
        refTarget={'button[data-testid="data-testid Tab Visualizations"]'}
        whenTrueChildren={[
          {
            type: 'interactive-step',
            props: { targetAction: 'highlight', refTarget: '.when-true-step' },
            children: [],
          },
        ]}
        whenFalseChildren={[]}
        renderElement={(element, childKey) => (
          <div data-testid={`rendered-${childKey}`} key={childKey}>
            {element.type}
          </div>
        )}
        keyPrefix="test"
      />
    );
  };

  it('shows whenTrue branch after interactive-action-completed without remounting', async () => {
    renderConditional(false);

    await act(async () => {
      jest.runAllTimers();
    });

    expect(screen.queryByTestId('rendered-test-true-0')).not.toBeInTheDocument();

    checkRequirementsFromData.mockResolvedValue({ pass: true, requirements: '', error: [] });

    await act(async () => {
      document.dispatchEvent(new CustomEvent('interactive-action-completed', { detail: {} }));
      jest.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(screen.getByTestId('rendered-test-true-0')).toBeInTheDocument();
    });
  });

  it('re-evaluates on pathfinder:progress (kind: step, completed) for exists-reftarget conditions', async () => {
    renderConditional(false);

    await act(async () => {
      jest.runAllTimers();
    });

    checkRequirementsFromData.mockResolvedValue({ pass: true, requirements: '', error: [] });

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('pathfinder:progress', {
          detail: { kind: 'step', stepId: 'prior-step', completed: true, reason: 'manual' },
        })
      );
      jest.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(screen.getByTestId('rendered-test-true-0')).toBeInTheDocument();
    });
  });

  it('does not show loading spinner on re-evaluation when branch was already resolved', async () => {
    checkRequirementsFromData.mockResolvedValue({ pass: true, requirements: '', error: [] });

    render(
      <InteractiveConditional
        conditions={['exists-reftarget']}
        refTarget="button.tab"
        whenTrueChildren={[
          {
            type: 'interactive-step',
            props: { targetAction: 'highlight', refTarget: '.step' },
            children: [],
          },
        ]}
        whenFalseChildren={[]}
        renderElement={() => <div>child</div>}
        keyPrefix="k"
      />
    );

    await act(async () => {
      jest.runAllTimers();
    });

    expect(screen.getByText('child')).toBeInTheDocument();
    expect(screen.queryByText('Checking conditions...')).not.toBeInTheDocument();

    checkRequirementsFromData.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ pass: false, requirements: '', error: [] }), 500);
        })
    );

    await act(async () => {
      document.dispatchEvent(new CustomEvent('interactive-action-completed', { detail: {} }));
      jest.advanceTimersByTime(300);
    });

    // Branch stays visible while re-check is in flight (no loading takeover)
    expect(screen.getByText('child')).toBeInTheDocument();
    expect(screen.queryByText('Checking conditions...')).not.toBeInTheDocument();
  });

  it('exposes conditional test id after evaluation', async () => {
    renderConditional(true);

    await act(async () => {
      jest.runAllTimers();
    });

    await waitFor(() => {
      expect(screen.getByTestId(testIds.interactive.conditional('exists-reftarget'))).toHaveAttribute(
        'data-passed',
        'true'
      );
    });
  });

  it('hides the numbered item when the selected branch is empty', async () => {
    const { container } = render(
      <div className={getInteractiveStyles(createTheme())}>
        <ol className="interactive-section-content">
          {wrapSectionChildrenForNumbering(
            <InteractiveConditional
              conditions={[]}
              whenTrueChildren={[]}
              whenFalseChildren={[]}
              renderElement={() => null}
              keyPrefix="empty"
            />
          )}
        </ol>
      </div>
    );
    const item = container.querySelector('ol > li') as HTMLLIElement;

    expect(item).toHaveAttribute('data-numbered', 'true');
    expect(item).not.toBeEmptyDOMElement();
    expect(getComputedStyle(item).display).not.toBe('none');

    await act(async () => {
      jest.runAllTimers();
    });

    expect(item).toBeEmptyDOMElement();
    expect(getComputedStyle(item).display).toBe('none');
  });

  it('keeps passive and interactive branches aligned under one number', async () => {
    render(
      <div className={getInteractiveStyles(createTheme())}>
        <ol className="interactive-section-content">
          {wrapSectionChildrenForNumbering(
            <InteractiveConditional
              conditions={['exists-reftarget']}
              whenTrueChildren={[{ type: 'interactive-step', props: {}, children: [] }]}
              whenFalseChildren={[{ type: 'p', props: {}, children: ['Passive branch'] }]}
              renderElement={(element, childKey) =>
                element.type === 'p' ? <p key={childKey}>Passive branch</p> : <ConditionalStepCard key={childKey} />
              }
              keyPrefix="mixed"
            />
          )}
        </ol>
      </div>
    );

    await act(async () => {
      jest.runAllTimers();
    });

    const passive = screen.getByText('Passive branch');
    expect(getComputedStyle(passive).paddingTop).toBe('16px');
    expect(getComputedStyle(passive).paddingLeft).toBe('calc(18px)');

    checkRequirementsFromData.mockResolvedValue({ pass: true, requirements: '', error: [] });
    await act(async () => {
      document.dispatchEvent(new CustomEvent('interactive-action-completed', { detail: {} }));
      jest.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(screen.getByText('Interactive branch')).toBeInTheDocument();
    });
    const interactive = screen.getByText('Interactive branch');
    expect(getComputedStyle(interactive).paddingLeft).not.toBe('calc(18px)');
  });

  it.each([
    ['passive before interactive', ['p', 'interactive-step'], true],
    ['interactive before passive', ['interactive-step', 'p'], false],
  ] as const)('aligns every child in a mixed branch: %s', async (_name, types, passiveIsFirst) => {
    render(
      <div className={getInteractiveStyles(createTheme())}>
        <ol className="interactive-section-content">
          {wrapSectionChildrenForNumbering(
            <InteractiveConditional
              conditions={['mixed-list']}
              whenTrueChildren={[]}
              whenFalseChildren={types.map((type) => ({ type, props: {}, children: [] }))}
              renderElement={(element, childKey) =>
                element.type === 'p' ? (
                  <p className="existing-class" key={childKey}>
                    Mixed passive child
                  </p>
                ) : (
                  <ConditionalStepCard key={childKey} />
                )
              }
              keyPrefix="mixed-list"
            />
          )}
        </ol>
      </div>
    );

    await act(async () => {
      jest.runAllTimers();
    });

    const passive = screen.getByText('Mixed passive child');
    const interactive = screen.getByText('Interactive branch');
    expect(passive).toHaveClass('existing-class');
    expect(getComputedStyle(passive).paddingLeft).toBe('calc(18px)');
    expect(getComputedStyle(passive).paddingTop === '16px').toBe(passiveIsFirst);
    expect(getComputedStyle(interactive).paddingLeft).not.toBe('calc(18px)');
  });

  it('aligns a passive leaf through nested conditionals without compounding the offset', async () => {
    const { container } = render(
      <div className={getInteractiveStyles(createTheme())}>
        <ol className="interactive-section-content">
          {wrapSectionChildrenForNumbering(<NestedPassiveConditional depth={3} keyPrefix="nested-root" />)}
        </ol>
      </div>
    );

    for (let depth = 0; depth < 3; depth += 1) {
      await act(async () => {
        jest.runAllTimers();
      });
    }

    const passive = screen.getByText('Nested passive branch');
    expect(container.querySelectorAll('.interactive-conditional')).toHaveLength(3);
    expect(getComputedStyle(passive).paddingTop).toBe('16px');
    expect(getComputedStyle(passive).paddingLeft).toBe('calc(18px)');
  });

  it('keeps section-display numbering separate from its outer position', async () => {
    checkRequirementsFromData.mockResolvedValue({ pass: true, requirements: '', error: [] });
    const { container } = render(
      <ol data-testid="outer-section" className="interactive-section-content">
        {wrapSectionChildrenForNumbering(
          <InteractiveConditional
            conditions={['section-display']}
            display="section"
            whenTrueChildren={[{ type: 'p', props: {}, children: ['Inner content'] }]}
            whenFalseChildren={[]}
            renderElement={(_element, childKey) => <p key={childKey}>Inner content</p>}
            keyPrefix="section-display"
          />
        )}
      </ol>
    );

    await act(async () => {
      jest.runOnlyPendingTimers();
    });

    const outerList = screen.getByTestId('outer-section');
    const outerItems = outerList.querySelectorAll(':scope > li[data-numbered="true"]');
    expect(outerItems).toHaveLength(1);

    const innerList = outerItems[0]?.querySelector('ol.interactive-section-content');
    expect(innerList).not.toBeNull();
    const innerItems = innerList?.querySelectorAll(':scope > li[data-numbered="true"]');
    expect(innerItems).toHaveLength(1);
    expect(innerItems?.[0]).toHaveTextContent('Inner content');
    expect(container.querySelectorAll('ol.interactive-section-content')).toHaveLength(2);
  });
});

/**
 * Integration-style reproduction of the original first-dashboard failure mode.
 * Drives the real InteractiveConditional with a real DOM mutation - no synthetic
 * events. If the MutationObserver path is wired correctly, the whenTrue branch
 * renders within the debounce window after the target element is injected.
 */
describe('InteractiveConditional - DOM mutation reproduction', () => {
  beforeEach(() => {
    jest.useRealTimers();
    checkRequirementsFromData.mockReset();
    // Realistic check: actually query the DOM, mirroring reftargetExistsCheck.
    checkRequirementsFromData.mockImplementation(async (data: { refTarget?: string }) => {
      const refTarget = data.refTarget ?? '';
      const found = refTarget ? document.querySelector(refTarget) !== null : false;
      return { pass: found, requirements: 'exists-reftarget', error: [] };
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders whenTrue branch when target element is injected post-mount', async () => {
    render(
      <InteractiveConditional
        conditions={['exists-reftarget']}
        refTarget={'button[data-testid="data-testid Tab Visualizations"]'}
        whenTrueChildren={[
          { type: 'interactive-step', props: { targetAction: 'highlight', refTarget: '.tab' }, children: [] },
        ]}
        whenFalseChildren={[]}
        renderElement={(_element, childKey) => <div data-testid={`branch-${childKey}`}>branch</div>}
        keyPrefix="repro"
      />
    );

    // Initial evaluation: target does not exist, whenTrue branch is hidden.
    await waitFor(() => {
      expect(screen.queryByTestId('branch-repro-true-0')).not.toBeInTheDocument();
    });

    // Simulate the picker animation completing and injecting the tab.
    const tab = document.createElement('button');
    tab.setAttribute('data-testid', 'data-testid Tab Visualizations');
    document.body.appendChild(tab);

    // MutationObserver fires synchronously, then a 200ms debounce, then evaluateConditions.
    // Plus the 250ms scheduleReevaluation delay - allow generous budget.
    await waitFor(
      () => {
        expect(screen.getByTestId('branch-repro-true-0')).toBeInTheDocument();
      },
      { timeout: 2000 }
    );

    // Conditional should expose data-passed="true" without any external action event firing.
    const wrapper = screen.getByTestId(testIds.interactive.conditional('exists-reftarget'));
    expect(wrapper).toHaveAttribute('data-passed', 'true');
  });

  it('does not re-subscribe MutationObserver when conditions array identity changes but contents are equal', async () => {
    // testing-library's waitFor uses MutationObserver internally, so spying on the
    // prototype catches both our observer and theirs. Track only observers that
    // observe `document.body` with our specific options.
    const observeCalls: MutationObserverInit[] = [];
    const disconnectCalls: unknown[] = [];

    const originalObserve = MutationObserver.prototype.observe;
    const originalDisconnect = MutationObserver.prototype.disconnect;

    MutationObserver.prototype.observe = function observe(
      this: MutationObserver,
      target: Node,
      options?: MutationObserverInit
    ) {
      // Component observer: targets document.body with childList + subtree.
      const isOurObserver =
        target === document.body && options?.childList === true && options?.subtree === true && !options?.attributes;
      if (isOurObserver && options) {
        observeCalls.push(options);
        // Tag so we can recognise disconnect from the same instance.
        (this as unknown as { __ourObserver?: boolean }).__ourObserver = true;
      }
      return originalObserve.call(this, target, options);
    } as typeof originalObserve;

    MutationObserver.prototype.disconnect = function disconnect(this: MutationObserver) {
      if ((this as unknown as { __ourObserver?: boolean }).__ourObserver) {
        disconnectCalls.push(this);
      }
      return originalDisconnect.call(this);
    } as typeof originalDisconnect;

    try {
      const Harness = ({ conds }: { conds: string[] }) => (
        <InteractiveConditional
          conditions={conds}
          refTarget={'button[data-testid="data-testid Tab Visualizations"]'}
          whenTrueChildren={[]}
          whenFalseChildren={[]}
          renderElement={(_e, k) => <div data-testid={`x-${k}`} />}
          keyPrefix="stable"
        />
      );

      const { rerender } = render(<Harness conds={['exists-reftarget']} />);

      // Wait for the initial effect to commit the observer subscription.
      await waitFor(() => {
        expect(observeCalls.length).toBe(1);
      });

      const initialObserveCount = observeCalls.length;
      const initialDisconnectCount = disconnectCalls.length;

      // Re-render with a new array reference but same contents. Without
      // conditionsKey memoization the observer would tear down and re-subscribe.
      rerender(<Harness conds={['exists-reftarget']} />);
      rerender(<Harness conds={['exists-reftarget']} />);
      rerender(<Harness conds={['exists-reftarget']} />);

      // Allow any pending effects to flush.
      await new Promise((r) => setTimeout(r, 50));

      expect(observeCalls.length).toBe(initialObserveCount);
      expect(disconnectCalls.length).toBe(initialDisconnectCount);
    } finally {
      MutationObserver.prototype.observe = originalObserve;
      MutationObserver.prototype.disconnect = originalDisconnect;
    }
  });

  it('discards stale evaluation results when a newer run supersedes them', async () => {
    // Pre-seed: no target element.
    let resolveFirst: ((value: { pass: boolean; requirements: string; error: never[] }) => void) | undefined;
    let resolveSecond: ((value: { pass: boolean; requirements: string; error: never[] }) => void) | undefined;
    let call = 0;

    checkRequirementsFromData.mockImplementation(
      () =>
        new Promise((resolve) => {
          call += 1;
          if (call === 1) {
            resolveFirst = resolve;
          } else if (call === 2) {
            resolveSecond = resolve;
          } else {
            resolve({ pass: true, requirements: '', error: [] });
          }
        })
    );

    render(
      <InteractiveConditional
        conditions={['exists-reftarget']}
        refTarget={'button.race'}
        whenTrueChildren={[
          { type: 'interactive-step', props: { targetAction: 'highlight', refTarget: '.race' }, children: [] },
        ]}
        whenFalseChildren={[]}
        renderElement={(_e, k) => <div data-testid={`race-${k}`}>race</div>}
        keyPrefix="race"
      />
    );

    // Wait until both runs have been started: the initial mount evaluation,
    // plus a re-evaluation triggered by an action event below.
    await waitFor(() => {
      expect(resolveFirst).toBeDefined();
    });

    // Trigger a second run.
    window.dispatchEvent(new CustomEvent('interactive-action-completed', { detail: {} }));

    await waitFor(() => {
      expect(resolveSecond).toBeDefined();
    });

    // Resolve the SECOND (newer) run first - the fresh result is "pass: true",
    // so the whenTrue branch should appear.
    resolveSecond!({ pass: true, requirements: '', error: [] });
    await waitFor(() => {
      expect(screen.getByTestId('race-race-true-0')).toBeInTheDocument();
    });

    // Now resolve the FIRST (stale) run with the OPPOSITE result. Without the
    // runId race guard this would flip the branch back off. With it, the stale
    // result is dropped.
    resolveFirst!({ pass: false, requirements: '', error: [] });

    // Give React a chance to flush.
    await new Promise((r) => setTimeout(r, 50));

    expect(screen.getByTestId('race-race-true-0')).toBeInTheDocument();
  });

  it('unmounts whenTrue branch when the target element disappears', async () => {
    // Pre-seed the target so the conditional renders true on first evaluation.
    const tab = document.createElement('button');
    tab.setAttribute('data-testid', 'data-testid Tab Visualizations');
    document.body.appendChild(tab);

    render(
      <InteractiveConditional
        conditions={['exists-reftarget']}
        refTarget={'button[data-testid="data-testid Tab Visualizations"]'}
        whenTrueChildren={[
          { type: 'interactive-step', props: { targetAction: 'highlight', refTarget: '.tab' }, children: [] },
        ]}
        whenFalseChildren={[]}
        renderElement={(_element, childKey) => <div data-testid={`branch-${childKey}`}>branch</div>}
        keyPrefix="reverse"
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('branch-reverse-true-0')).toBeInTheDocument();
    });

    // Remove the element - MutationObserver should fire and the branch should disappear.
    tab.remove();

    await waitFor(
      () => {
        expect(screen.queryByTestId('branch-reverse-true-0')).not.toBeInTheDocument();
      },
      { timeout: 2000 }
    );
  });
});
