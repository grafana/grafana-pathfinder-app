import type { JsonCheckpointCheck } from '../types/json-guide.types';
import type { CheckpointAdapter, CheckpointResult } from '../recovery/section-checkpoint';
import { resolveSelector } from '../lib/dom/selector-resolver';
import { isElementVisible } from '../lib/dom/element-validator';
import { checkVerdict } from '../lib/check-verdict';
import { dispatchFix } from './fix-registry';
import { getRequirementExplanation } from './requirements-explanations';
import type { FixContext } from './fix-handlers';
import type { RequirementsCheckOptions, RequirementsCheckResult } from './requirements-checker.utils';

const RESTORABLE_FIXES = new Set(['location', 'navigation', 'expand-parent-navigation', 'dashboard-state']);

function readControl(check: Extract<JsonCheckpointCheck, { target: string }>) {
  try {
    const elements = document.querySelectorAll<HTMLElement>(resolveSelector(check.target));
    if (elements.length !== 1) {
      return null;
    }
    const element = elements[0]!;
    if (!isElementVisible(element) || element.matches(':disabled, [aria-disabled="true"]')) {
      return null;
    }
    const attribute = check.state === 'expanded' ? 'aria-expanded' : 'aria-selected';
    const value = element.getAttribute(attribute);
    const interactive =
      (element instanceof HTMLButtonElement && element.type === 'button') ||
      element.matches('div[role="tab"], span[role="tab"]');
    const safeControl =
      interactive &&
      !element.closest('a[href]') &&
      !(element instanceof HTMLButtonElement && element.type !== 'button');
    return {
      element,
      passed: check.state === 'visible' || value === 'true',
      restorable: safeControl && value === 'false',
    };
  } catch {
    return null;
  }
}

export function createCheckpointAdapter(
  checkRequirements: (options: RequirementsCheckOptions) => Promise<RequirementsCheckResult>,
  fixContext: () => Promise<Omit<FixContext, 'requirements'>>,
  signal: AbortSignal
): CheckpointAdapter {
  const readRequirement = async (requirement: string) => {
    if (requirement.startsWith('coda-exit-zero:') || requirement === 'exists-reftarget') {
      return null;
    }
    return checkRequirements({ requirements: [requirement], maxRetries: 0, targetAction: 'section' });
  };
  return {
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
      return {
        passed: control?.passed ?? false,
        canRestore: !!control && !control.passed && check.state !== 'visible' && control.restorable,
        explanation: control
          ? check.state === 'expanded'
            ? 'A required control was collapsed.'
            : 'The required tab is not selected.'
          : 'The required control is missing, unavailable, or ambiguous. Return to the expected view and check again.',
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
        return (await dispatchFix({ ...context, ...error, requirements: [check.requirement] })).ok;
      }
      const control = readControl(check);
      if (!control || signal.aborted) {
        return false;
      }
      if (control.passed) {
        return true;
      }
      if (!control.restorable || check.state === 'visible') {
        return false;
      }
      control.element.click();
      return true;
    },
  };
}
