/**
 * Behavior tests for `discoverStepsFromDOM` (complements the source-scanning
 * parity checks in step-kind-marker.parity.test.ts).
 *
 * Builds a minimal fake Playwright `Page`/`Locator` on top of jsdom so these
 * tests exercise the real selector strings and extraction logic against
 * actual DOM fixtures, instead of only asserting on discovery.ts's source
 * text. Covers:
 *   - marker-first discovery selecting only executable kinds
 *   - the completed-step badge never being discovered as a step
 *   - the legacy fallback firing when no marker is present, and excluding
 *     the completed-step badge there too
 *   - deferred kinds (quiz/terminal/terminal-connect/codeblock/challenge)
 *     never reaching the generic executor, including guides made up
 *     entirely of deferred-kind content
 */

// Mock @playwright/test before any imports that use it (mirrors discovery.test.ts).
jest.mock('@playwright/test', () => ({
  Page: jest.fn(),
  Locator: jest.fn(),
  expect: jest.fn(),
  test: jest.fn(),
}));

import type { Page } from '@playwright/test';
import { discoverStepsFromDOM } from './discovery';

/**
 * Minimal fake Playwright Locator backed by real jsdom elements. Only
 * implements the surface discovery.ts actually calls.
 */
class FakeLocator {
  constructor(private readonly elements: Element[]) {}

  async all(): Promise<FakeLocator[]> {
    return this.elements.map((el) => new FakeLocator([el]));
  }

  first(): FakeLocator {
    return new FakeLocator(this.elements.slice(0, 1));
  }

  async count(): Promise<number> {
    return this.elements.length;
  }

  async isVisible(): Promise<boolean> {
    const el = this.elements[0];
    return el != null && !el.hasAttribute('hidden');
  }

  async getAttribute(name: string): Promise<string | null> {
    return this.elements[0]?.getAttribute(name) ?? null;
  }

  async scrollIntoViewIfNeeded(): Promise<void> {
    // no-op: jsdom has no layout engine
  }

  async evaluate<T>(fn: (el: Element) => T): Promise<T> {
    return fn(this.elements[0]!);
  }
}

/** Minimal fake Playwright Page backed by a real jsdom root node. */
class FakePage {
  constructor(private readonly root: ParentNode) {}

  locator(selector: string): FakeLocator {
    return new FakeLocator(Array.from(this.root.querySelectorAll(selector)));
  }

  getByTestId(testId: string): FakeLocator {
    return this.locator(`[data-testid="${testId}"]`);
  }
}

function fakePage(html: string): Page {
  document.body.innerHTML = html;
  return new FakePage(document.body) as unknown as Page;
}

afterEach(() => {
  document.body.innerHTML = '';
  jest.restoreAllMocks();
});

describe('discoverStepsFromDOM — marker-first discovery', () => {
  it('selects only executable-kind steps and excludes deferred kinds and the completed badge', async () => {
    const page = fakePage(`
      <div data-test-step-kind="plain" data-step-id="step-1" data-testid="interactive-step-step-1" data-test-step-state="idle" data-targetaction="button" data-reftarget=".btn"></div>
      <span data-testid="interactive-step-completed-step-1"></span>

      <div data-test-step-kind="multistep" data-step-id="multi-1" data-testid="interactive-step-multi-1" data-test-step-state="idle" data-targetaction="multistep" data-internal-actions="[1,2]"></div>

      <div data-test-step-kind="guided" data-step-id="guided-1" data-testid="interactive-step-guided-1" data-test-step-state="idle" data-test-substep-total="3"></div>

      <div data-test-step-kind="quiz" data-step-id="quiz-1" data-testid="interactive-quiz-quiz-1" data-test-step-state="idle"></div>

      <div data-test-step-kind="terminal" data-step-id="terminal-1" data-testid="interactive-terminal-terminal-1" data-test-step-state="idle"></div>
    `);

    const result = await discoverStepsFromDOM(page);

    expect(result.totalSteps).toBe(3);
    const ids = result.steps.map((s) => s.stepId);
    expect(ids).toEqual(['step-1', 'multi-1', 'guided-1']);
    expect(ids).not.toContain('quiz-1');
    expect(ids).not.toContain('terminal-1');

    const kinds = result.steps.map((s) => s.kind);
    expect(kinds).toEqual(['plain', 'multistep', 'guided']);
  });

  it('reports guided substep count from data-test-substep-total', async () => {
    const page = fakePage(`
      <div data-test-step-kind="guided" data-step-id="guided-1" data-testid="interactive-step-guided-1" data-test-substep-total="4"></div>
    `);

    const result = await discoverStepsFromDOM(page);

    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({ isGuided: true, guidedStepCount: 4 });
  });
});

describe('discoverStepsFromDOM — legacy fallback', () => {
  it('falls back to the legacy testid selector when no marker is present, and excludes the completed badge', async () => {
    const page = fakePage(`
      <div data-testid="interactive-step-legacy-1" data-targetaction="button" data-reftarget=".btn">
        <button data-testid="interactive-do-it-legacy-1">Do it</button>
      </div>
      <span data-testid="interactive-step-completed-legacy-1"></span>
    `);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

    const result = await discoverStepsFromDOM(page);

    expect(result.totalSteps).toBe(1);
    expect(result.steps[0]).toMatchObject({ stepId: 'legacy-1', kind: 'legacy', hasDoItButton: true });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('falling back'));
  });

  it('derives the legacy stepId from data-step-id when present instead of the testid prefix', async () => {
    const page = fakePage(`
      <div data-step-id="explicit-id" data-testid="interactive-step-legacy-2"></div>
    `);
    jest.spyOn(console, 'warn').mockImplementation();

    const result = await discoverStepsFromDOM(page);

    expect(result.steps[0]?.stepId).toBe('explicit-id');
    expect(result.steps[0]?.kind).toBe('legacy');
  });
});

describe('discoverStepsFromDOM — deferred kinds never reach the generic executor', () => {
  it('returns zero steps for a guide made up entirely of deferred-kind content', async () => {
    const page = fakePage(`
      <div data-test-step-kind="quiz" data-step-id="quiz-1" data-testid="interactive-quiz-quiz-1"></div>
      <div data-test-step-kind="challenge" data-step-id="challenge-1" data-testid="challenge-block-challenge-1"></div>
      <div data-test-step-kind="codeblock" data-step-id="code-1" data-testid="code-block-step-code-1"></div>
    `);
    jest.spyOn(console, 'warn').mockImplementation();

    const result = await discoverStepsFromDOM(page);

    expect(result.totalSteps).toBe(0);
    expect(result.steps).toEqual([]);
  });

  it('excludes deferred-kind steps even when they are interleaved with executable steps', async () => {
    const page = fakePage(`
      <div data-test-step-kind="challenge" data-step-id="challenge-1" data-testid="challenge-block-challenge-1"></div>
      <div data-test-step-kind="plain" data-step-id="step-1" data-testid="interactive-step-step-1"></div>
      <div data-test-step-kind="terminal-connect" data-step-id="tc-1" data-testid="interactive-terminal-connect-tc-1"></div>
    `);

    const result = await discoverStepsFromDOM(page);

    expect(result.totalSteps).toBe(1);
    expect(result.steps[0]?.stepId).toBe('step-1');
  });
});
