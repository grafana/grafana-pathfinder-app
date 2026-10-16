import type { JsonBlock, JsonGuide, JsonInputBlock } from '../types/json-guide.types';
import { parseChoiceRequirement } from '../lib/choice-response';

export interface ChoiceReferenceIssue {
  message: string;
  path: Array<string | number>;
  type: 'suggestion';
}

export function validateChoiceReferences(guide: JsonGuide): ChoiceReferenceIssue[] {
  const issues: ChoiceReferenceIssue[] = [];
  const inputs = new Map<string, { block: JsonInputBlock; order: number }>();
  const blocks: Array<{ block: JsonBlock; path: Array<string | number>; order: number }> = [];
  function visit(children: readonly JsonBlock[], prefix: Array<string | number>) {
    children.forEach((block, index) => {
      const path = [...prefix, index];
      const order = blocks.length;
      blocks.push({ block, path, order });
      if (block.type === 'input' && block.inputType === 'checkbox-group') {
        if (inputs.has(block.variableName)) {
          issues.push({
            message: `Checkbox groups must use distinct variable names: ${block.variableName}`,
            path,
            type: 'suggestion',
          });
        }
        inputs.set(block.variableName, { block, order });
      }
      if ('blocks' in block) {
        visit(block.blocks, [...path, 'blocks']);
      }
      if (block.type === 'conditional') {
        visit(block.whenTrue, [...path, 'whenTrue']);
        visit(block.whenFalse, [...path, 'whenFalse']);
      }
    });
  }
  visit(guide.blocks, ['blocks']);
  for (const { block, path, order } of blocks) {
    for (const field of ['requirements', 'conditions'] as const) {
      const tokens =
        field === 'conditions'
          ? block.type === 'conditional'
            ? block.conditions
            : []
          : 'requirements' in block
            ? (block.requirements ?? [])
            : [];
      tokens.forEach((token, index) => {
        const choice = parseChoiceRequirement(token);
        if (!choice) {
          return;
        }
        const input = inputs.get(choice.variableName);
        const issuePath = [...path, field, index];
        if (!input) {
          issues.push({
            message: `No checkbox group defines ${choice.variableName}`,
            path: issuePath,
            type: 'suggestion',
          });
        } else if (!input.block.choices?.some((option) => option.id === choice.optionId)) {
          issues.push({
            message: `The checkbox group ${choice.variableName} has no option ${choice.optionId}`,
            path: issuePath,
            type: 'suggestion',
          });
        } else if (order < input.order) {
          issues.push({
            message: 'Place the checkbox group before content that depends on its answer',
            path: issuePath,
            type: 'suggestion',
          });
        }
      });
    }
  }
  return issues;
}
