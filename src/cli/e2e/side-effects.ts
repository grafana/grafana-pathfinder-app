import {
  isAssistantBlock,
  isChallengeBlock,
  isCodeBlockBlock,
  isConditionalBlock,
  isGrotGuideBlock,
  isGuidedBlock,
  isHtmlBlock,
  isImageBlock,
  isInputBlock,
  isInteractiveBlock,
  isMarkdownBlock,
  isMultistepBlock,
  isQuizBlock,
  isSectionBlock,
  isSnippetRefBlock,
  isTerminalBlock,
  isTerminalConnectBlock,
  isVideoBlock,
  type JsonBlock,
  type JsonGuide,
  type JsonInteractiveAction,
  type JsonStep,
} from '../../types/json-guide.types';

export type SideEffectLevel = 'readonly' | 'possibly_mutating' | 'mutating' | 'unknown';

export interface SideEffectReason {
  level: Exclude<SideEffectLevel, 'readonly'>;
  path: string;
  message: string;
}

export interface SideEffectClassification {
  level: SideEffectLevel;
  reasons: SideEffectReason[];
}

const LEVEL_SCORE: Record<SideEffectLevel, number> = {
  readonly: 0,
  possibly_mutating: 1,
  unknown: 2,
  mutating: 3,
};

const MUTATING_TEXT_PATTERN =
  /\b(save|create|delete|destroy|remove|update|submit|apply|import|provision|install|enable|disable|add)\b/i;
const POSSIBLY_MUTATING_TEXT_PATTERN = /\b(new|edit|configure|config|settings|admin|manage)\b/i;
const MUTATING_ROUTE_PATTERN =
  /\/(dashboard\/new|dashboards\/new|connections\/datasources\/new|datasources\/new|alerting|admin|plugins|org|users|teams|serviceaccounts|api-keys)(?:\/|$|[?#])/i;
const READONLY_ROUTE_PATTERN =
  /\/(explore|drilldown)(?:\/|$|[?#])|\/dashboards(?:$|[?#])|\/d\/[^/?#]+(?:\/|$|[?#])|\/alerting\/list(?:\/|$|[?#])|\/connections\/datasources(?:$|[?#])/i;

function mergeClassifications(classifications: SideEffectClassification[]): SideEffectClassification {
  const reasons = classifications.flatMap((classification) => classification.reasons);
  const level = classifications.reduce<SideEffectLevel>(
    (highest, classification) =>
      LEVEL_SCORE[classification.level] > LEVEL_SCORE[highest] ? classification.level : highest,
    'readonly'
  );
  return { level, reasons };
}

function reason(level: Exclude<SideEffectLevel, 'readonly'>, path: string, message: string): SideEffectClassification {
  return { level, reasons: [{ level, path, message }] };
}

function readonly(): SideEffectClassification {
  return { level: 'readonly', reasons: [] };
}

function textEvidence(action: string, value: string | undefined, path: string): SideEffectClassification | undefined {
  if (!value) {
    return undefined;
  }
  if (MUTATING_TEXT_PATTERN.test(value)) {
    return reason('mutating', path, `${action} target looks state-changing: ${value}`);
  }
  if (POSSIBLY_MUTATING_TEXT_PATTERN.test(value)) {
    return reason('possibly_mutating', path, `${action} target may lead to state changes: ${value}`);
  }
  return undefined;
}

function routeEvidence(path: string, route: string | undefined): SideEffectClassification | undefined {
  if (!route) {
    return undefined;
  }
  if (READONLY_ROUTE_PATTERN.test(route)) {
    return readonly();
  }
  if (MUTATING_ROUTE_PATTERN.test(route)) {
    return reason('possibly_mutating', path, `Navigation target is a configuration or creation route: ${route}`);
  }
  return undefined;
}

function classifyAction(
  action: JsonInteractiveAction | undefined,
  target: string | undefined,
  targetValue: string | undefined,
  path: string
): SideEffectClassification {
  if (!action) {
    return reason('unknown', path, 'Interactive action is missing');
  }

  if (action === 'noop' || action === 'highlight' || action === 'hover' || action === 'popout') {
    return readonly();
  }

  if (action === 'navigate') {
    return routeEvidence(path, target) ?? readonly();
  }

  if (action === 'button') {
    return (
      textEvidence('Button', target, path) ??
      textEvidence('Button value', targetValue, path) ??
      reason('possibly_mutating', path, 'Button click may mutate Grafana state')
    );
  }

  if (action === 'formfill') {
    return (
      textEvidence('Form fill', target, path) ??
      textEvidence('Form fill value', targetValue, path) ??
      reason('possibly_mutating', path, 'Form fill may be submitted later')
    );
  }

  return reason('unknown', path, `Unrecognized action: ${action}`);
}

function classifyStep(step: JsonStep, path: string): SideEffectClassification {
  return classifyAction(
    step.action ?? step.targetAction,
    step.reftarget ?? step.refTarget,
    step.targetvalue ?? step.targetValue,
    path
  );
}

function classifySteps(steps: JsonStep[] | undefined, path: string): SideEffectClassification {
  if (!Array.isArray(steps)) {
    return reason('unknown', path, 'Step list is missing or invalid');
  }
  return mergeClassifications(steps.map((step, index) => classifyStep(step, `${path}.steps[${index}]`)));
}

function classifyBlocks(blocks: JsonBlock[] | undefined, path: string): SideEffectClassification {
  if (!Array.isArray(blocks)) {
    return reason('unknown', path, 'Block list is missing or invalid');
  }
  return mergeClassifications(blocks.map((block, index) => classifyBlock(block, `${path}[${index}]`)));
}

function classifyBlock(block: JsonBlock, path: string): SideEffectClassification {
  if (
    isMarkdownBlock(block) ||
    isHtmlBlock(block) ||
    isImageBlock(block) ||
    isVideoBlock(block) ||
    isQuizBlock(block) ||
    isInputBlock(block) ||
    isGrotGuideBlock(block)
  ) {
    return readonly();
  }
  if (isInteractiveBlock(block)) {
    return classifyAction(
      block.action ?? block.targetAction,
      block.reftarget ?? block.refTarget,
      block.targetvalue ?? block.targetValue,
      path
    );
  }
  if (isMultistepBlock(block) || isGuidedBlock(block)) {
    return classifySteps(block.steps, path);
  }
  if (isSectionBlock(block)) {
    return classifyBlocks(block.blocks, `${path}.blocks`);
  }
  if (isConditionalBlock(block)) {
    return mergeClassifications([
      classifyBlocks(block.whenTrue, `${path}.whenTrue`),
      classifyBlocks(block.whenFalse, `${path}.whenFalse`),
    ]);
  }
  if (isAssistantBlock(block)) {
    return classifyBlocks(block.blocks, `${path}.blocks`);
  }
  if (isCodeBlockBlock(block)) {
    return reason('possibly_mutating', path, 'Code insertion may be saved or executed later');
  }
  if (isTerminalBlock(block) || isTerminalConnectBlock(block) || isChallengeBlock(block)) {
    return reason('unknown', path, `${block.type} block can have side effects outside static guide analysis`);
  }
  if (isSnippetRefBlock(block)) {
    return reason('unknown', path, 'Snippet content is resolved at parse time and must be classified after expansion');
  }
  return reason('unknown', path, 'Unknown block type');
}

export function classifyGuideSideEffects(guide: JsonGuide): SideEffectClassification {
  return classifyBlocks(guide.blocks, 'blocks');
}

export function classifyGuideSideEffectsFromString(content: string): SideEffectClassification {
  try {
    const guide = JSON.parse(content) as JsonGuide;
    return classifyGuideSideEffects(guide);
  } catch (err) {
    return reason(
      'unknown',
      '$',
      `Guide JSON could not be parsed: ${err instanceof Error ? err.message : 'Unknown error'}`
    );
  }
}

export function isUnsafeSideEffectLevel(level: SideEffectLevel): boolean {
  return level !== 'readonly';
}
