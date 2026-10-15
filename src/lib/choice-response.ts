export function decodeChoiceSelection(value: unknown, knownIds?: readonly string[]): string[] {
  if (typeof value !== 'string') {
    return [];
  }
  return [
    ...new Set(
      value.split(',').filter((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id) && (!knownIds || knownIds.includes(id)))
    ),
  ];
}

export function encodeChoiceSelection(selectedIds: readonly string[], optionOrder: readonly string[]): string {
  return optionOrder.filter((id) => selectedIds.includes(id)).join(',');
}

export function evaluateChoiceConditions(
  conditions: unknown,
  responses: Readonly<Record<string, unknown>>
): boolean | undefined {
  if (
    !Array.isArray(conditions) ||
    conditions.length === 0 ||
    !conditions.every((token) => typeof token === 'string' && parseChoiceRequirement(token))
  ) {
    return undefined;
  }
  return conditions.every((token: string) => {
    const condition = parseChoiceRequirement(token)!;
    return decodeChoiceSelection(responses[condition.variableName]).includes(condition.optionId);
  });
}

export function parseChoiceRequirement(token: string): { variableName: string; optionId: string } | null {
  const match = /^var-([A-Za-z_][A-Za-z0-9_]*):includes:([A-Za-z0-9_-]{1,64})$/.exec(token);
  return match ? { variableName: match[1]!, optionId: match[2]! } : null;
}
