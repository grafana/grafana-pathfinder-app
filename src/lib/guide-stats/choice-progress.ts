import type { JsonBlock, JsonInputBlock } from '../../types/json-guide.types';
import { decodeChoiceSelection, parseChoiceRequirement, evaluateChoiceConditions } from '../choice-response';
import type { GuideBlockIndex } from './block-index';
import type { CompletionEvidence, GuideProgress } from './progress';
import { sectionRuntimeId } from './section-identity';

export const CHOICE_COMPLETION_VARIABLE = '__choice_completed_blocks';

type Responses = Readonly<Record<string, unknown>>;
interface ChoicePosition {
  position: number;
  key: string;
  scope: string;
  containers: string[];
  visibility: string[];
  hiddenConditional?: string[];
  input?: JsonInputBlock;
}
export interface ChoiceProgressModel {
  positions: ChoicePosition[];
  sectionConditions: Record<string, string[]>;
}

export function createChoiceProgressModel(
  blocks: readonly JsonBlock[],
  index: GuideBlockIndex
): ChoiceProgressModel | undefined {
  const positions: ChoicePosition[] = [];
  const sectionConditions: Record<string, string[]> = {};
  let hasChoices = false;
  const byPath = new Map(index.blocks.map((block) => [block.path.join('.'), block.position]));
  function visit(
    children: readonly JsonBlock[],
    prefix: number[],
    jsonPath: string,
    scope: string,
    containers: string[],
    visibility: string[]
  ) {
    children.forEach((block, childIndex) => {
      const path = [...prefix, childIndex];
      const fullPath = `${jsonPath}[${childIndex}]`;
      if (block.type === 'input' && block.inputType === 'checkbox-group') {
        hasChoices = true;
      }
      if (block.type === 'section' || block.type === 'assistant' || block.type === 'collapsible') {
        const section = block.type === 'section' ? sectionRuntimeId(block.id, fullPath) : scope;
        if (block.type === 'section' && block.whenRequirementsUnmet && block.whenRequirementsUnmet !== 'disable') {
          hasChoices = true;
          sectionConditions[section] = block.requirements ?? [];
        }
        const gates =
          block.type === 'section' && block.whenRequirementsUnmet && block.whenRequirementsUnmet !== 'disable'
            ? [...visibility, section]
            : visibility;
        visit(
          block.blocks,
          path,
          `${fullPath}.blocks`,
          section,
          block.type === 'section' ? [...containers, section] : containers,
          gates
        );
        return;
      }
      const position = byPath.get(path.join('.'));
      if (position === undefined) {
        return;
      }
      positions.push({
        position,
        key: block.id ?? `${scope}:${childIndex}`,
        scope,
        containers,
        visibility,
        ...(block.type === 'conditional' &&
          block.whenFalse.length === 0 &&
          block.conditions.every((condition) => parseChoiceRequirement(condition)) && {
            hiddenConditional: block.conditions,
          }),
        ...(block.type === 'input' && block.inputType === 'checkbox-group' && { input: block }),
      });
    });
  }
  visit(blocks, [], 'blocks', '__common__', [], []);
  return hasChoices ? { positions, sectionConditions } : undefined;
}

function activePositions(
  model: ChoiceProgressModel,
  responses: Responses,
  hiddenSections: ReadonlySet<string>
): ChoicePosition[] {
  return model.positions.filter(
    (item) =>
      !item.visibility.some((section) => {
        const pass = evaluateChoiceConditions(model.sectionConditions[section], responses);
        return pass === undefined ? hiddenSections.has(section) : !pass;
      }) &&
      (!item.hiddenConditional ||
        item.hiddenConditional.every((token) => {
          const condition = parseChoiceRequirement(token)!;
          return decodeChoiceSelection(responses[condition.variableName]).includes(condition.optionId);
        }))
  );
}

export function choicePathCompletionKeys(
  model: ChoiceProgressModel,
  responses: Responses,
  hiddenSections: ReadonlySet<string>
): string[] {
  return activePositions(model, responses, hiddenSections).map((item) => item.key);
}

export function choicePathHasUnansweredRequiredInput(
  model: ChoiceProgressModel,
  responses: Responses,
  hiddenSections: ReadonlySet<string>
): boolean {
  return activePositions(model, responses, hiddenSections).some(
    (item) =>
      item.input?.required &&
      decodeChoiceSelection(
        responses[item.input.variableName],
        item.input.choices?.map((choice) => choice.id)
      ).length === 0
  );
}

export function choiceGuideProgress(
  model: ChoiceProgressModel,
  index: GuideBlockIndex,
  evidence: readonly CompletionEvidence[],
  responses: Responses,
  hiddenSections: ReadonlySet<string>
): GuideProgress {
  const active = activePositions(model, responses, hiddenSections);
  const byPosition = new Map(model.positions.map((item) => [item.position, item]));
  const furthestByScope = new Map<string, number>();
  const acknowledged = new Set(
    evidence.filter((signal) => signal.kind === 'mark-section-complete').map((signal) => signal.blockId)
  );
  for (const signal of evidence) {
    if (signal.kind !== 'do-it' || !signal.blockId) {
      continue;
    }
    const position =
      index.branchChildPositions.get(signal.blockId) ??
      index.positionsByStepId.get(signal.blockId) ??
      index.positionsById.get(signal.blockId);
    const item = position === undefined ? undefined : byPosition.get(position);
    if (item) {
      furthestByScope.set(item.scope, Math.max(furthestByScope.get(item.scope) ?? 0, item.position));
    }
  }
  let markedKeys: string[] = [];
  try {
    const parsed: unknown = JSON.parse(String(responses[CHOICE_COMPLETION_VARIABLE] ?? '[]'));
    if (Array.isArray(parsed)) {
      markedKeys = parsed.filter((key): key is string => typeof key === 'string');
    }
  } catch {
    markedKeys = [];
  }
  const isAnswered = (input: JsonInputBlock) =>
    decodeChoiceSelection(
      responses[input.variableName],
      input.choices?.map((choice) => choice.id)
    ).length > 0;
  const unanswered = active.some((item) => item.input?.required && !isAnswered(item.input));
  const completed = active.filter((item) =>
    item.input
      ? !item.input.required || isAnswered(item.input)
      : markedKeys.includes(item.key) ||
        item.containers.some((section) => acknowledged.has(section)) ||
        item.position <= (furthestByScope.get(item.scope) ?? 0)
  ).length;
  const total = active.length;
  const complete = !unanswered && total > 0 && completed === total;
  const fraction = total === 0 ? 0 : completed / total;
  return {
    position: completed,
    totalBlockCount: total,
    fraction,
    percent: complete ? 100 : Math.min(99, Math.floor(fraction * 100)),
    complete,
  };
}
