import type { JsonGuide } from '../types/json-guide.types';
import type { KioskInput } from '../types/kiosk-page.schema';
import type { ParsedElement } from '../types/content.types';
import { parseMarkdownToElements } from './json-parser';

function validateDisplay(content: string, names: Set<string>): void {
  const marker = '/pathfinderkioskinputtoken';
  const marked = content.replace(/\{\{(\w+)\}\}/g, (match, name: string) => (names.has(name) ? marker : match));
  const containsMarker = (value: unknown): boolean => {
    if (typeof value === 'string') {
      return value.includes(marker);
    }
    if (Array.isArray(value)) {
      return value.some(containsMarker);
    }
    return !!value && typeof value === 'object' && Object.values(value).some(containsMarker);
  };
  function inspect(element: ParsedElement | string, inCode = false): void {
    if (typeof element === 'string') {
      if (inCode && containsMarker(element)) {
        throw new Error('Inputs cannot be used in code');
      }
      return;
    }
    if (containsMarker(element.props)) {
      throw new Error('Inputs cannot be used in HTML attributes or links');
    }
    element.children.forEach((child) => inspect(child, inCode || element.type === 'code' || element.type === 'pre'));
  }
  // Use the renderer's Markdown parser and DOMPurify pipeline before inspecting sinks.
  parseMarkdownToElements(marked, 'https://grafana.com/docs/').forEach((element) => inspect(element));
}

export function validateKioskDestination(guide: JsonGuide, inputs: KioskInput[]): void {
  const names = new Set(inputs.map((input) => input.variableName));
  const declarations = new Map<string, Array<Record<string, unknown>>>();
  const hasVariable = (value: string) =>
    Array.from(value.matchAll(/\{\{(\w+)\}\}/g)).some((match) => names.has(match[1]!));

  function walk(value: unknown, parent?: Record<string, unknown>, field?: string): void {
    if (typeof value === 'string') {
      if (!hasVariable(value)) {
        return;
      }
      const display =
        (field === 'content' && ['markdown', 'interactive'].includes(String(parent?.type))) ||
        (['title', 'prompt', 'description'].includes(field ?? '') && parent?.type !== 'html');
      const formfill = field === 'targetvalue' && parent?.action === 'formfill';
      if (!display && !formfill) {
        throw new Error('Guide inputs may only be used in displayed text and form-fill values');
      }
      if (display) {
        validateDisplay(value, names);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry) => walk(entry, parent, field));
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    const object = value as Record<string, unknown>;
    if (object.type === 'snippet-ref') {
      throw new Error('All snippets must resolve before transferring inputs');
    }
    if (object.type === 'input' && typeof object.variableName === 'string' && names.has(object.variableName)) {
      declarations.set(object.variableName, [...(declarations.get(object.variableName) ?? []), object]);
    }
    for (const [key, child] of Object.entries(object)) {
      if (hasVariable(key)) {
        throw new Error('Input variables cannot be used as field names');
      }
      walk(child, object, key);
    }
  }
  walk(guide);
  for (const input of inputs) {
    const matches = declarations.get(input.variableName) ?? [];
    const destination = matches[0];
    if (
      matches.length !== 1 ||
      !destination ||
      destination.inputType !== input.inputType ||
      destination.format !== input.format ||
      destination.datasourceFilter !== input.datasourceFilter ||
      (destination.required === true && input.required !== true)
    ) {
      throw new Error('Each kiosk input must match one compatible input in the guide');
    }
    if (
      destination.pattern !== undefined ||
      destination.dataCheckQuery !== undefined ||
      destination.dataCheckBlocking
    ) {
      throw new Error(
        'Kiosk handoff does not support regex validation or data checks; collect this input in the guide'
      );
    }
  }
}
