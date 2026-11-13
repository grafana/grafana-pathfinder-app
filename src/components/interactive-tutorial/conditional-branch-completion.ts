import type { ParsedElement } from '../../docs-retrieval';
import type { CompletionEvidence } from '../../lib/guide-stats/progress';
import { STEP_TYPE_PARSE_KEYS } from './step-type-registry';

export function completedParsedBranch(elements: ParsedElement[], evidence: readonly CompletionEvidence[]): boolean {
  const completed = new Set(evidence.filter((item) => item.kind === 'do-it').map((item) => item.blockId));
  const inspect = (nodes: ParsedElement[]): { hasWork: boolean; complete: boolean } => {
    let hasWork = false;
    let complete = true;
    for (const node of nodes) {
      if ((STEP_TYPE_PARSE_KEYS as readonly string[]).includes(node.type)) {
        hasWork = true;
        complete &&= typeof node.props.stepId === 'string' && completed.has(node.props.stepId);
      } else if (node.type === 'interactive-conditional') {
        const yes = inspect(node.props.whenTrueChildren ?? []);
        const no = inspect(node.props.whenFalseChildren ?? []);
        hasWork ||= yes.hasWork || no.hasWork;
        complete &&= (!yes.hasWork && !no.hasWork) || (yes.hasWork && yes.complete) || (no.hasWork && no.complete);
      } else {
        const child = inspect(node.children.filter((item): item is ParsedElement => typeof item !== 'string'));
        hasWork ||= child.hasWork;
        complete &&= child.complete;
      }
    }
    return { hasWork, complete };
  };
  const result = inspect(elements);
  return result.hasWork && result.complete;
}
