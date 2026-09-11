import type { ElementHandle, Locator } from '@playwright/test';

import { getGuidedStepTimeout } from '../../../../../src/constants/interactive-config';
import type { StepSubstepResult } from '../types';

const GUIDED_ACTIONS = ['button', 'highlight', 'hover', 'formfill', 'noop'] as const;
const GUIDED_STATUSES = ['completed', 'skipped', 'timeout', 'cancelled', 'error'] as const;

export function isGuidedAction(value: unknown): value is StepSubstepResult['action'] {
  return typeof value === 'string' && (GUIDED_ACTIONS as readonly string[]).includes(value);
}

export function parseGuidedSubstepResults(raw: string | null): StepSubstepResult[] | undefined {
  if (raw === null) {
    return undefined;
  }
  let values: unknown;
  try {
    values = JSON.parse(raw);
  } catch {
    throw new Error('Invalid JSON in data-test-substep-results');
  }
  if (!Array.isArray(values)) {
    throw new Error('data-test-substep-results must be an array');
  }
  const results = new Map<number, StepSubstepResult>();
  for (const value of values) {
    if (
      !value ||
      typeof value !== 'object' ||
      !Number.isInteger(value.index) ||
      value.index < 0 ||
      !isGuidedAction(value.action) ||
      !(GUIDED_STATUSES as readonly unknown[]).includes(value.status) ||
      typeof value.durationMs !== 'number' ||
      !Number.isFinite(value.durationMs) ||
      value.durationMs < 0
    ) {
      throw new Error('Invalid record in data-test-substep-results');
    }
    results.set(value.index, {
      index: value.index,
      action: value.action,
      status: value.status,
      durationMs: value.durationMs,
    });
  }
  return [...results.values()].sort((left, right) => left.index - right.index);
}

export interface GuidedSnapshot {
  attached: boolean;
  state: string | null;
  index: number | undefined;
  skippable: boolean | undefined;
  timeoutMs: number;
  formState: string | null;
  substeps: StepSubstepResult[] | undefined;
}

export interface GuidedEvidence {
  read(): Promise<GuidedSnapshot>;
  results(): StepSubstepResult[] | undefined;
  recordActionFailure(index: number, error: string): void;
  dispose(): Promise<void>;
}

export async function captureGuidedEvidence(
  locator: Locator,
  onSubsteps?: (substeps: StepSubstepResult[]) => void
): Promise<GuidedEvidence> {
  let root: ElementHandle<HTMLElement | SVGElement> | null = null;
  if ((await locator.count()) > 0) {
    try {
      root = await locator.elementHandle({ timeout: 2000 });
    } catch (error) {
      if ((await locator.count()) > 0) {
        throw error;
      }
    }
  }

  let substeps: StepSubstepResult[] | undefined;
  const failures = new Map<number, string>();
  const publish = (records: StepSubstepResult[]) => {
    const next = records.map((record) => ({
      ...record,
      ...(record.status !== 'completed' && failures.has(record.index) ? { error: failures.get(record.index) } : {}),
    }));
    if (JSON.stringify(next) !== JSON.stringify(substeps)) {
      substeps = next;
      onSubsteps?.(next.map((record) => ({ ...record })));
    }
  };
  let lastSnapshot: GuidedSnapshot = {
    attached: false,
    state: null,
    index: undefined,
    skippable: undefined,
    timeoutMs: getGuidedStepTimeout(),
    formState: null,
    substeps: undefined,
  };

  return {
    async read() {
      if (!root) {
        return lastSnapshot;
      }
      let raw;
      try {
        // The original root retains its final attributes after section detachment.
        raw = await root.evaluate((element) => ({
          attached: element.isConnected,
          state: element.getAttribute('data-test-step-state'),
          index: element.getAttribute('data-test-substep-index'),
          skippable: element.getAttribute('data-test-substep-skippable'),
          timeout: element.getAttribute('data-test-step-timeout'),
          formState: element.getAttribute('data-test-form-state'),
          results: element.getAttribute('data-test-substep-results'),
        }));
      } catch (error) {
        if ((await locator.count()) > 0) {
          throw error;
        }
        return { ...lastSnapshot, attached: false, substeps };
      }
      const records = parseGuidedSubstepResults(raw.results);
      if (records !== undefined) {
        publish(records);
      }
      const index = raw.index === null || raw.index === '' ? undefined : Number(raw.index);
      lastSnapshot = {
        attached: raw.attached,
        state: raw.state,
        index: index !== undefined && Number.isInteger(index) && index >= 0 ? index : undefined,
        skippable: raw.skippable === null ? undefined : raw.skippable === 'true',
        timeoutMs: getGuidedStepTimeout(raw.timeout === null ? undefined : Number(raw.timeout)),
        formState: raw.formState,
        substeps,
      };
      return lastSnapshot;
    },
    results: () => substeps?.map((record) => ({ ...record })),
    recordActionFailure(index, error) {
      failures.set(index, error);
      if (substeps !== undefined) {
        publish(substeps);
      }
    },
    async dispose() {
      await root?.dispose().catch(() => undefined);
    },
  };
}
