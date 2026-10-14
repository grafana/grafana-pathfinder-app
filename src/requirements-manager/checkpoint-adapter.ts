import type { JsonCheckpointCheck } from '../types/json-guide.types';
import type { CheckpointAdapter, CheckpointResult } from '../recovery/section-checkpoint';
import { resolveSelector } from '../lib/dom/selector-resolver';
import { isElementVisible, isReplaySafeControl } from '../lib/dom/element-validator';
import { querySelectorAllEnhanced } from '../lib/dom/enhanced-selector';
import { checkVerdict } from '../lib/check-verdict';
import { dispatchFix } from './fix-registry';
import { getRequirementExplanation } from './requirements-explanations';
import type { FixContext } from './fix-handlers';
import type { RequirementsCheckOptions, RequirementsCheckResult } from './requirements-checker.utils';
import { isCheckpointRequirement } from '../types/requirements.types';
import { PATHFINDER_ACTIVATION_PARAMS } from '../utils/pathfinder-search-params';

const RESTORABLE_FIXES = new Set(['location', 'navigation', 'expand-parent-navigation', 'dashboard-state']);

type ControlRead =
  | { kind: 'missing' }
  | { kind: 'unverifiable'; reason: 'ambiguous' | 'no-state-attribute' }
  | { kind: 'found'; element: HTMLElement; passed: boolean; restorable: boolean };

function readControl(check: Extract<JsonCheckpointCheck, { target: string }>): ControlRead {
  try {
    const { elements } = querySelectorAllEnhanced(resolveSelector(check.target));
    if (elements.length > 1) {
      return { kind: 'unverifiable', reason: 'ambiguous' };
    }
    const element = elements[0];
    if (!element || !isElementVisible(element) || element.matches(':disabled, [aria-disabled="true"]')) {
      return { kind: 'missing' };
    }
    if (check.state === 'visible') {
      return { kind: 'found', element, passed: true, restorable: false };
    }
    const value = element.getAttribute(check.state === 'expanded' ? 'aria-expanded' : 'aria-selected');
    if (value === null) {
      return { kind: 'unverifiable', reason: 'no-state-attribute' };
    }
    return {
      kind: 'found',
      element,
      passed: value === 'true',
      restorable: isReplaySafeControl(element) && value === 'false',
    };
  } catch {
    return { kind: 'missing' };
  }
}

function resumeHref(lastReadyUrl: string | undefined, requiredPath: string | undefined): string | undefined {
  if (!lastReadyUrl || !requiredPath) {
    return undefined;
  }
  const url = new URL(lastReadyUrl, window.location.origin);
  if (!url.pathname.includes(requiredPath)) {
    return undefined;
  }
  PATHFINDER_ACTIVATION_PARAMS.forEach((param) => url.searchParams.delete(param));
  return url.pathname + url.search;
}

export interface CheckpointAdapterOptions {
  replay?: CheckpointAdapter['replay'];
  lastReadyUrl?: () => string | undefined;
}

export function createCheckpointAdapter(
  checkRequirements: (options: RequirementsCheckOptions) => Promise<RequirementsCheckResult>,
  fixContext: () => Promise<Omit<FixContext, 'requirements'>>,
  signal: AbortSignal,
  { replay, lastReadyUrl }: CheckpointAdapterOptions = {}
): CheckpointAdapter {
  const readRequirement = async (requirement: string) => {
    if (!isCheckpointRequirement(requirement)) {
      return null;
    }
    return checkRequirements({ requirements: [requirement], maxRetries: 0, targetAction: 'section' });
  };
  return {
    replay,
    check: async (check): Promise<CheckpointResult> => {
      if (signal.aborted) {
        return { passed: false, canRestore: false };
      }
      if ('requirement' in check) {
        const result = await readRequirement(check.requirement);
        const error = result?.error.find((entry) => !entry.pass);
        return {
          passed: !!result && checkVerdict(result) === 'satisfied',
          canRestore: !!error?.canFix && RESTORABLE_FIXES.has(error.fixType ?? ''),
          explanation:
            getRequirementExplanation(check.requirement, undefined, error?.error) ||
            'The required state could not be verified.',
        };
      }
      const control = readControl(check);
      if (control.kind === 'unverifiable') {
        return { passed: true, canRestore: false, unverifiable: control.reason };
      }
      if (control.kind === 'missing') {
        return {
          passed: false,
          canRestore: false,
          explanation: 'The required control is missing or unavailable. Return to the expected view and check again.',
        };
      }
      return {
        passed: control.passed,
        canRestore: !control.passed && control.restorable,
        explanation:
          check.state === 'expanded' ? 'A required control was collapsed.' : 'The required tab is not selected.',
      };
    },
    restore: async (check) => {
      if (signal.aborted) {
        return false;
      }
      if ('requirement' in check) {
        const result = await readRequirement(check.requirement);
        if (result && checkVerdict(result) === 'satisfied') {
          return true;
        }
        const error = result?.error.find((entry) => !entry.pass);
        if (!error?.canFix || !RESTORABLE_FIXES.has(error.fixType ?? '')) {
          return false;
        }
        const context = await fixContext();
        if (signal.aborted) {
          return false;
        }
        const targetHref =
          error.fixType === 'location'
            ? (resumeHref(lastReadyUrl?.(), error.targetHref) ?? error.targetHref)
            : error.targetHref;
        return (await dispatchFix({ ...context, ...error, targetHref, requirements: [check.requirement] })).ok;
      }
      const control = readControl(check);
      if (signal.aborted || control.kind === 'missing') {
        return false;
      }
      if (control.kind === 'unverifiable' || control.passed) {
        return true;
      }
      if (!control.restorable) {
        return false;
      }
      control.element.click();
      return true;
    },
  };
}
