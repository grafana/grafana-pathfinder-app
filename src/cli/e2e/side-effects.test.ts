import { classifyGuideSideEffects, classifyGuideSideEffectsFromString } from './side-effects';
import type { JsonGuide } from '../../types/json-guide.types';

function guide(blocks: JsonGuide['blocks']): JsonGuide {
  return { id: 'g', title: 'Guide', blocks };
}

describe('classifyGuideSideEffects', () => {
  it('classifies instructional and observational guides as readonly', () => {
    const result = classifyGuideSideEffects(
      guide([
        { type: 'markdown', content: 'Read this' },
        { type: 'quiz', question: 'Pick one', choices: [{ id: 'a', text: 'A', correct: true }] },
        { type: 'interactive', action: 'highlight', reftarget: '[data-testid="panel"]', content: 'Look here' },
        { type: 'interactive', action: 'navigate', reftarget: '/explore', content: 'Open Explore' },
      ])
    );

    expect(result).toEqual({ level: 'readonly', reasons: [] });
  });

  it('classifies destructive and save-like buttons as mutating', () => {
    const result = classifyGuideSideEffects(
      guide([{ type: 'interactive', action: 'button', reftarget: 'Save dashboard', content: 'Save your work' }])
    );

    expect(result.level).toBe('mutating');
    expect(result.reasons[0]).toMatchObject({ level: 'mutating', path: 'blocks[0]' });
    expect(result.reasons[0]!.message).toContain('Save dashboard');
  });

  it('classifies generic button and formfill actions as possible mutations', () => {
    const result = classifyGuideSideEffects(
      guide([
        { type: 'interactive', action: 'button', reftarget: '[data-testid="refresh"]', content: 'Click refresh' },
        { type: 'interactive', action: 'formfill', reftarget: 'textarea[data-testid="query"]', content: 'Enter query' },
      ])
    );

    expect(result.level).toBe('possibly_mutating');
    expect(result.reasons).toHaveLength(2);
  });

  it('uses target values as classifier evidence', () => {
    const result = classifyGuideSideEffects(
      guide([
        {
          type: 'interactive',
          action: 'formfill',
          reftarget: 'input[name="name"]',
          targetvalue: 'new dashboard',
          content: 'Name the dashboard',
        },
      ])
    );

    expect(result.level).toBe('possibly_mutating');
    expect(result.reasons[0]!.message).toContain('new dashboard');
  });

  it('classifies creation and admin routes as possible mutations', () => {
    const result = classifyGuideSideEffects(
      guide([
        { type: 'interactive', action: 'navigate', reftarget: '/connections/datasources/new', content: 'Add one' },
      ])
    );

    expect(result.level).toBe('possibly_mutating');
    expect(result.reasons[0]!.message).toContain('/connections/datasources/new');
  });

  it('lets explicit read-only routes override broader mutating route families', () => {
    const result = classifyGuideSideEffects(
      guide([{ type: 'interactive', action: 'navigate', reftarget: '/alerting/list', content: 'View alert rules' }])
    );

    expect(result).toEqual({ level: 'readonly', reasons: [] });
  });

  it('does not let read-only list routes cover creation subroutes', () => {
    const list = classifyGuideSideEffects(
      guide([
        {
          type: 'interactive',
          action: 'navigate',
          reftarget: '/connections/datasources',
          content: 'View data sources',
        },
      ])
    );
    const create = classifyGuideSideEffects(
      guide([
        {
          type: 'interactive',
          action: 'navigate',
          reftarget: '/connections/datasources/new',
          content: 'Create data source',
        },
      ])
    );

    expect(list).toEqual({ level: 'readonly', reasons: [] });
    expect(create.level).toBe('possibly_mutating');
  });

  it('walks nested sections, conditionals, assistants, guided, and multistep blocks', () => {
    const result = classifyGuideSideEffects(
      guide([
        {
          type: 'section',
          blocks: [
            {
              type: 'conditional',
              conditions: ['has-datasource:prometheus'],
              whenTrue: [{ type: 'assistant', blocks: [{ type: 'markdown', content: 'No-op' }] }],
              whenFalse: [
                {
                  type: 'guided',
                  content: 'Create a data source',
                  steps: [{ action: 'button', reftarget: 'Create data source' }],
                },
              ],
            },
          ],
        },
        {
          type: 'multistep',
          content: 'Read-only tour',
          steps: [{ action: 'highlight', reftarget: '[data-testid="x"]' }],
        },
      ])
    );

    expect(result.level).toBe('mutating');
    expect(result.reasons[0]).toMatchObject({ path: 'blocks[0].blocks[0].whenFalse[0].steps[0]' });
  });

  it('keeps unknown blocks distinct from possible mutations', () => {
    const result = classifyGuideSideEffects(guide([{ type: 'snippet-ref', snippetId: 'shared-setup' }]));

    expect(result.level).toBe('unknown');
    expect(result.reasons[0]!.message).toMatch(/Snippet content/);
  });

  it('classifies invalid JSON as unknown', () => {
    const result = classifyGuideSideEffectsFromString('{not json');

    expect(result.level).toBe('unknown');
    expect(result.reasons[0]).toMatchObject({ path: '$' });
  });
});
