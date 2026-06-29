import { ExitCode } from './exit-codes';
import type { GuideRunResult, PackageMeta } from './e2e-results';
import { isUnsafeSideEffectLevel } from './side-effects';

interface PlannedGuideRef {
  id: string;
}

interface PlannedGuideForSkip extends PlannedGuideRef {
  guide: {
    path: string;
  };
  autoIncluded: boolean;
}

export function unsafeCloudGuidesInChain(
  chain: PlannedGuideRef[],
  packageMetaById: Map<string, PackageMeta>
): PlannedGuideRef[] {
  return chain.filter((planned) => {
    const meta = packageMetaById.get(planned.id);
    return meta?.tier === 'cloud' && (!meta.sideEffects || isUnsafeSideEffectLevel(meta.sideEffects.level));
  });
}

export function unsafeSharedStackMessage(unsafeIds: string[]): string {
  return `Cloud chain contains unsafe guide(s) ${unsafeIds.join(', ')} and requires an isolated stack path`;
}

export function unsafeSharedStackSkipResults(
  chain: PlannedGuideForSkip[],
  packageMetaById: Map<string, PackageMeta>,
  message: string
): GuideRunResult[] {
  return chain.map((planned) => {
    const meta = packageMetaById.get(planned.id);
    return {
      guide: planned.guide.path,
      id: planned.id,
      status: 'skipped_unsafe_shared_stack',
      exitCode: ExitCode.SUCCESS,
      autoIncluded: planned.autoIncluded,
      abortMessage: message,
      tier: meta?.tier,
      sideEffects: meta?.sideEffects,
    };
  });
}
