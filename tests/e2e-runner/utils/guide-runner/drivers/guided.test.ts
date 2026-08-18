jest.mock('@playwright/test', () => ({}));

import type { Page } from '@playwright/test';
import { GuidedSubstepResultSchema } from '../../../../../src/cli/e2e/schemas/e2e-report.schema';
import { GUIDED_ACTION_TYPES } from '../../../../../src/types/interactive-actions.types';

import { startGuidedEvidenceCollector } from './guided';
import type { GuidedSubstepResult } from '../types';

interface FakeEvidencePage {
  page: Page;
  dispatch(detail: unknown): void;
  navigate(): void;
  close(): void;
}

function createEvidencePage(): FakeEvidencePage {
  let initScript: ((options: { bindingName: string; eventName: string }) => void) | undefined;
  let initOptions: { bindingName: string; eventName: string } | undefined;
  let closeHandler: (() => void) | undefined;
  const page = {
    exposeBinding: jest.fn(async (name: string, callback: (_source: unknown, detail: unknown) => unknown) => {
      (window as unknown as Record<string, unknown>)[name] = (detail: unknown) => callback({}, detail);
    }),
    addInitScript: jest.fn(
      async (
        script: (options: { bindingName: string; eventName: string }) => void,
        options: { bindingName: string; eventName: string }
      ) => {
        initScript = script;
        initOptions = options;
      }
    ),
    evaluate: jest.fn(
      async (
        script: (options: { bindingName: string; eventName: string }) => void,
        options: { bindingName: string; eventName: string }
      ) => script(options)
    ),
    once: jest.fn((_event: string, callback: () => void) => {
      closeHandler = callback;
    }),
    waitForTimeout: jest.fn().mockResolvedValue(undefined),
  } as unknown as Page;

  return {
    page,
    dispatch: (detail) => {
      document.dispatchEvent(new CustomEvent('pathfinder:guided-substep-settled', { detail }));
    },
    navigate: () => {
      delete (window as typeof window & { __pathfinderGuidedEvidenceForwarderInstalled?: boolean })
        .__pathfinderGuidedEvidenceForwarderInstalled;
      initScript?.(initOptions!);
    },
    close: () => closeHandler?.(),
  };
}

describe('guided evidence collector', () => {
  it('matches the process-boundary Zod mirror', () => {
    const internal: GuidedSubstepResult = { index: 2, action: 'formfill', outcome: 'skipped' };
    expect(GuidedSubstepResultSchema.parse(internal)).toEqual(internal);
    expect(GuidedSubstepResultSchema.shape.action.options).toEqual(GUIDED_ACTION_TYPES);
  });
  it('retains consecutive runtime skips and a final skip after root detachment', async () => {
    delete (window as typeof window & { __pathfinderGuidedEvidenceForwarderInstalled?: boolean })
      .__pathfinderGuidedEvidenceForwarderInstalled;
    const fake = createEvidencePage();
    const collector = await startGuidedEvidenceCollector(fake.page, 'parent-step');

    for (let index = 0; index < 4; index++) {
      fake.dispatch({
        stepId: 'parent-step',
        index,
        action: index === 3 ? 'noop' : 'highlight',
        outcome: 'skipped',
      });
    }
    fake.dispatch({ stepId: 'parent-step', index: 3, action: 'noop', outcome: 'skipped' });

    expect(await collector.read()).toEqual([
      { index: 0, action: 'highlight', outcome: 'skipped' },
      { index: 1, action: 'highlight', outcome: 'skipped' },
      { index: 2, action: 'highlight', outcome: 'skipped' },
      { index: 3, action: 'noop', outcome: 'skipped' },
    ]);

    await collector.dispose();
  });

  it('ignores evidence for a different parent step', async () => {
    delete (window as typeof window & { __pathfinderGuidedEvidenceForwarderInstalled?: boolean })
      .__pathfinderGuidedEvidenceForwarderInstalled;
    const fake = createEvidencePage();
    const collector = await startGuidedEvidenceCollector(fake.page, 'parent-step');

    fake.dispatch({ stepId: 'other-step', index: 0, action: 'button', outcome: 'passed' });

    expect(await collector.read()).toEqual([]);
    await collector.dispose();
  });

  it('captures a substep from a document installed after navigation', async () => {
    delete (window as typeof window & { __pathfinderGuidedEvidenceForwarderInstalled?: boolean })
      .__pathfinderGuidedEvidenceForwarderInstalled;
    const fake = createEvidencePage();
    const collector = await startGuidedEvidenceCollector(fake.page, 'parent-step');

    fake.dispatch({ stepId: 'parent-step', index: 0, action: 'highlight', outcome: 'passed' });
    fake.navigate();
    fake.dispatch({ stepId: 'parent-step', index: 1, action: 'button', outcome: 'passed' });

    expect(await collector.read()).toEqual([
      { index: 0, action: 'highlight', outcome: 'passed' },
      { index: 1, action: 'button', outcome: 'passed' },
    ]);
    await collector.dispose();
  });

  it('clears active page evidence on close', async () => {
    delete (window as typeof window & { __pathfinderGuidedEvidenceForwarderInstalled?: boolean })
      .__pathfinderGuidedEvidenceForwarderInstalled;
    const fake = createEvidencePage();
    const collector = await startGuidedEvidenceCollector(fake.page, 'parent-step');
    fake.close();
    fake.dispatch({ stepId: 'parent-step', index: 0, action: 'button', outcome: 'passed' });

    expect(await collector.read()).toEqual([]);
  });
});
