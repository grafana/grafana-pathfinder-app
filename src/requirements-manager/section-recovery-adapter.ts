import { locationService } from '@grafana/runtime';
import type { RecoveryAdapter, RecoveryResult } from '../recovery/section-recovery';
import type { RecoveryAction, RecoveryCondition } from '../recovery/section-recovery-plan';
import { readTargetState } from '../lib/dom/target-state-read';
import { checkVerdict } from '../lib/check-verdict';
import { dispatchFix } from './fix-registry';
import type { FixContext } from './fix-handlers';
import type { RequirementsCheckOptions, RequirementsCheckResult } from './requirements-checker.utils';
import { isLivePageRequirement } from '../types/requirements.types';
import { PATHFINDER_ACTIVATION_PARAMS } from '../utils/pathfinder-search-params';

const RESTORABLE_FIXES = new Set(['location', 'navigation', 'expand-parent-navigation', 'dashboard-state']);

function resumeTarget(lastReadyUrl: string): string {
  const url = new URL(lastReadyUrl, window.location.origin);
  PATHFINDER_ACTIVATION_PARAMS.forEach((param) => url.searchParams.delete(param));
  return url.pathname + url.search;
}

function onPathOf(lastReadyUrl: string): boolean {
  return new URL(lastReadyUrl, window.location.origin).pathname === locationService.getLocation().pathname;
}

function resumeHref(lastReadyUrl: string | undefined, requiredPath: string | undefined): string | undefined {
  if (
    !lastReadyUrl ||
    !requiredPath ||
    !new URL(lastReadyUrl, window.location.origin).pathname.includes(requiredPath)
  ) {
    return undefined;
  }
  return resumeTarget(lastReadyUrl);
}

export function createRecoveryAdapter(
  checkRequirements: (options: RequirementsCheckOptions) => Promise<RequirementsCheckResult>,
  fixContext: () => Promise<Omit<FixContext, 'requirements'>>,
  signal: AbortSignal,
  lastReadyUrl: () => string | undefined
): RecoveryAdapter {
  const readRequirement = async (requirement: string) =>
    isLivePageRequirement(requirement)
      ? checkRequirements({ requirements: [requirement], maxRetries: 0, targetAction: 'section' })
      : null;
  const navigate = async (targetHref: string, requirements: string[]) => {
    const context = await fixContext();
    return !signal.aborted && (await dispatchFix({ ...context, fixType: 'location', targetHref, requirements })).ok;
  };

  const check = async (condition: RecoveryCondition): Promise<RecoveryResult> => {
    if (signal.aborted) {
      return { passed: false, canRestore: false };
    }
    switch (condition.kind) {
      case 'requirement': {
        const result = await readRequirement(condition.requirement);
        const error = result?.error.find((entry) => !entry.pass);
        return {
          passed: !!result && checkVerdict(result) === 'satisfied',
          canRestore: !!error?.canFix && RESTORABLE_FIXES.has(error.fixType ?? ''),
        };
      }
      case 'target-present': {
        const result = await checkRequirements({
          requirements: ['exists-reftarget'],
          refTarget: condition.refTarget,
          targetAction: condition.targetAction,
          maxRetries: 0,
        });
        return { passed: checkVerdict(result) === 'satisfied', canRestore: false };
      }
      case 'target-state': {
        const read = await readTargetState(condition.refTarget, condition.targetAction, condition.targetState);
        return { passed: read.state === 'satisfied', canRestore: false };
      }
      case 'resume-location': {
        const url = lastReadyUrl();
        return { passed: !url || onPathOf(url), canRestore: false };
      }
    }
  };

  return {
    check,
    restore: async (condition) => {
      if (signal.aborted || condition.kind !== 'requirement') {
        return false;
      }
      const result = await readRequirement(condition.requirement);
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
          ? (resumeHref(lastReadyUrl(), error.targetHref) ?? error.targetHref)
          : error.targetHref;
      return (await dispatchFix({ ...context, ...error, targetHref, requirements: [condition.requirement] })).ok;
    },
    replay: async (action: RecoveryAction) => {
      if (signal.aborted) {
        return false;
      }
      if (action.kind === 'resume-location') {
        const url = lastReadyUrl();
        return !!url && (onPathOf(url) || (await navigate(resumeTarget(url), [])));
      }
      const read = await readTargetState(action.refTarget, action.targetAction, action.targetState);
      if (read.state === 'replayable' && !signal.aborted) {
        read.control.click();
        return true;
      }
      return read.state === 'satisfied';
    },
    canReplay: async (action: RecoveryAction) => {
      if (action.kind === 'resume-location') {
        const url = lastReadyUrl();
        return !!url && !onPathOf(url);
      }
      return (await readTargetState(action.refTarget, action.targetAction, action.targetState)).state === 'replayable';
    },
  };
}
