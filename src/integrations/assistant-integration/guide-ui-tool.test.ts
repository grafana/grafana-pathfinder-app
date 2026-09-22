import { createGuideUiTool, inspectGuideSelectors } from './guide-ui-tool';
import type { ToolInvokeOptions } from '@grafana/assistant';

jest.mock('@grafana/runtime', () => ({
  config: { buildInfo: { version: '13.2.2' } },
  locationService: { getLocation: () => ({ pathname: '/dashboard/new' }) },
}));
jest.mock('@grafana/assistant', () => ({
  createTool: (invoke: (input: unknown) => unknown, spec: { validate: (input: unknown) => unknown }) => ({
    ...spec,
    invoke: async (input: unknown) => invoke(spec.validate(input)),
  }),
}));

const options = {} as ToolInvokeOptions;
beforeEach(() => {
  jest.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
});
afterEach(() => {
  document.body.replaceChildren();
  jest.restoreAllMocks();
});

function add(tag: string, attrs: Record<string, string> = {}) {
  const el = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
  document.body.appendChild(el);
  return el;
}

it('distinguishes unique, missing, ambiguous, hidden, and unsupported targets', () => {
  add('button', { id: 'unique' });
  add('button', { class: 'duplicate' });
  add('button', { class: 'duplicate' });
  add('button', { id: 'hidden', style: 'visibility: hidden' });
  add('input', { id: 'transparent', style: 'opacity: 0' });
  const checks = inspectGuideSelectors([
    '#unique',
    '#missing',
    '.duplicate',
    '#hidden',
    '#transparent',
    '{grafana:components.DoesNotExist}',
  ]);
  expect(checks.map((check) => check.status)).toEqual([
    'unique-visible-match',
    'not-visible-here',
    'ambiguous',
    'not-visible-here',
    'not-visible-here',
    'unsupported-selector',
  ]);
});

it('excludes editor and modal controls from product matches', () => {
  const editor = add('div', { 'data-testid': 'block-editor-container' });
  editor.appendChild(document.createElement('textarea'));
  const modal = add('div', { role: 'dialog' });
  modal.appendChild(document.createElement('textarea'));
  expect(inspectGuideSelectors(['textarea'])[0]?.visibleMatches).toBe(0);
});

it('provides ordered Code and Monaco steps with live evidence without reading query values', async () => {
  const mode = add('div', { 'data-testid': 'data-testid QueryEditorModeToggle' });
  const code = document.createElement('input');
  code.setAttribute('data-testid', 'data-testid radio-button-option code');
  code.type = 'radio';
  code.style.opacity = '0';
  mode.appendChild(code);
  mode.appendChild(document.createElement('label'));
  const field = add('div', { 'data-testid': 'data-testid Query field' });
  const textarea = document.createElement('textarea');
  textarea.value = 'private_query';
  field.appendChild(textarea);
  const onInspect = jest.fn();
  const tool = createGuideUiTool(onInspect, () => true);
  const result = String(await tool.invoke({}, options));
  expect(result).not.toContain('private_query');
  const parsed = JSON.parse(result);
  expect(parsed.prometheusQuery.steps.map((step: { type: string }) => step.type)).toEqual([
    'interactive',
    'code-block',
  ]);
  expect(
    parsed.prometheusQuery.currentPageChecks.map((check: { visibleMatches: number }) => check.visibleMatches)
  ).toEqual([1, 1]);
  expect(parsed.prometheusQuery.steps[0]).toMatchObject({
    targetstate: 'true',
    reftarget: expect.stringContaining('+ label'),
  });
  expect(code.checked).toBe(false);
  expect(textarea.value).toBe('private_query');
  expect(onInspect).toHaveBeenCalledTimes(1);
});

it('bounds inspection input and calls and respects cancellation', async () => {
  let active = true;
  const onInspect = jest.fn();
  const tool = createGuideUiTool(onInspect, () => active);
  await expect(tool.invoke({ selectors: Array(9).fill('button') }, options)).rejects.toThrow(/eight/);
  await expect(tool.invoke({ selectors: ['x'.repeat(501)] }, options)).rejects.toThrow(/500/);
  for (let i = 0; i < 4; i++) {
    await tool.invoke({}, options);
  }
  expect(await tool.invoke({}, options)).toContain('limit reached');
  active = false;
  expect(await tool.invoke({}, options)).toContain('cancelled');
  expect(onInspect).toHaveBeenCalledTimes(4);
});
