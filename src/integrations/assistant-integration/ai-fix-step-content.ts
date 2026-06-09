interface LooseBlock {
  id?: string;
  type?: string;
  content?: unknown;
  tooltip?: unknown;
  steps?: unknown;
  blocks?: unknown;
  whenTrue?: unknown;
  whenFalse?: unknown;
}

export function findGuideBlockById(blocks: unknown[], id: string): LooseBlock | null {
  for (const raw of blocks) {
    if (!raw || typeof raw !== 'object') {
      continue;
    }
    const block = raw as LooseBlock;
    if (block.id === id) {
      return block;
    }
    if (Array.isArray(block.blocks)) {
      const nested = findGuideBlockById(block.blocks, id);
      if (nested) {
        return nested;
      }
    }
    if (Array.isArray(block.whenTrue)) {
      const nested = findGuideBlockById(block.whenTrue, id);
      if (nested) {
        return nested;
      }
    }
    if (Array.isArray(block.whenFalse)) {
      const nested = findGuideBlockById(block.whenFalse, id);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}

export function extractStepContent(
  guideJson: string,
  stepId: string,
  containerInfo?: { containerId: string; subStepIndex: number }
): string {
  if (!guideJson) {
    return '';
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(guideJson);
  } catch {
    return '';
  }
  const targetId = containerInfo?.containerId ?? stepId;
  if (!targetId || !parsed || typeof parsed !== 'object') {
    return '';
  }
  const blocks = (parsed as { blocks?: unknown }).blocks;
  if (!Array.isArray(blocks)) {
    return '';
  }
  const found = findGuideBlockById(blocks, targetId);
  if (!found) {
    return '';
  }
  const parts: string[] = [];
  if (typeof found.content === 'string' && found.content.trim()) {
    parts.push(found.content.trim());
  }
  if (typeof found.tooltip === 'string' && found.tooltip.trim()) {
    parts.push(`Tooltip: ${found.tooltip.trim()}`);
  }
  if (containerInfo && Array.isArray(found.steps)) {
    const sub = found.steps[containerInfo.subStepIndex];
    if (sub && typeof sub === 'object') {
      const subAny = sub as { comment?: unknown; content?: unknown; hint?: unknown };
      if (typeof subAny.content === 'string' && subAny.content.trim()) {
        parts.push(`Sub-step content: ${subAny.content.trim()}`);
      }
      if (typeof subAny.comment === 'string' && subAny.comment.trim()) {
        parts.push(`Sub-step comment: ${subAny.comment.trim()}`);
      }
      if (typeof subAny.hint === 'string' && subAny.hint.trim()) {
        parts.push(`Sub-step hint: ${subAny.hint.trim()}`);
      }
    }
  }
  return parts.join('\n').slice(0, 1500);
}
