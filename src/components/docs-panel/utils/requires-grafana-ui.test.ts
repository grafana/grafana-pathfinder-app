import { requiresGrafanaUi } from './requires-grafana-ui';
import type { JsonBlock, JsonGuide, JsonInteractiveAction } from '../../../types/json-guide.types';

function guide(blocks: JsonBlock[]): JsonGuide {
  return { id: 'g', title: 'g', blocks };
}

const GRAFANA_DRIVING: JsonInteractiveAction[] = ['highlight', 'button', 'formfill', 'navigate', 'hover'];
const NON_DRIVING: JsonInteractiveAction[] = ['noop', 'popout'];

describe('requiresGrafanaUi', () => {
  it('returns false for a prose-only guide', () => {
    expect(
      requiresGrafanaUi(
        guide([
          { type: 'markdown', content: 'hello' },
          { type: 'html', content: '<p>hi</p>' },
          { type: 'image', src: 'a.png' },
        ])
      )
    ).toBe(false);
  });

  describe('the five Grafana-driving actions each trigger it', () => {
    it.each(GRAFANA_DRIVING)('interactive block with action=%s', (action) => {
      expect(requiresGrafanaUi(guide([{ type: 'interactive', action, content: 'do', reftarget: '#x' }]))).toBe(true);
    });

    it.each(GRAFANA_DRIVING)('reads the camelCase targetAction alias (=%s)', (action) => {
      expect(
        requiresGrafanaUi(guide([{ type: 'interactive', action: 'noop', targetAction: action, content: 'do' }]))
      ).toBe(true);
    });
  });

  describe('non-Grafana-driving actions and in-panel controls do NOT trigger it', () => {
    it.each(NON_DRIVING)('interactive block with action=%s stays full-screen', (action) => {
      expect(requiresGrafanaUi(guide([{ type: 'interactive', action, content: 'x' }]))).toBe(false);
    });

    it('quiz / input / terminal / challenge / code-block / grot-guide do not trigger it', () => {
      expect(
        requiresGrafanaUi(
          guide([
            { type: 'quiz', question: 'q', choices: [{ id: 'a', text: 'a', correct: true }] },
            { type: 'input', prompt: 'p', inputType: 'text', variableName: 'v' },
            { type: 'terminal', command: 'ls', content: 'run it' },
            { type: 'terminal-connect', content: 'connect' },
            { type: 'challenge', title: 't', brief: 'b', successCriteria: 'coda-exit-zero:true' },
            { type: 'code-block', reftarget: '#editor', code: 'x = 1' },
            {
              type: 'grot-guide',
              welcome: { title: 'w', body: 'b', ctas: [] },
              screens: [{ type: 'result', id: 'r', title: 'done', body: 'b' }],
            },
          ])
        )
      ).toBe(false);
    });
  });

  describe('nesting', () => {
    it('detects an action inside a section', () => {
      expect(
        requiresGrafanaUi(
          guide([{ type: 'section', title: 's', blocks: [{ type: 'interactive', action: 'button', content: 'go' }] }])
        )
      ).toBe(true);
    });

    it('detects an action inside an assistant block', () => {
      expect(
        requiresGrafanaUi(
          guide([{ type: 'assistant', blocks: [{ type: 'interactive', action: 'highlight', content: 'go' }] }])
        )
      ).toBe(true);
    });

    it('detects an action in a multistep step', () => {
      expect(
        requiresGrafanaUi(
          guide([
            {
              type: 'multistep',
              content: 'seq',
              steps: [{ action: 'noop' }, { action: 'formfill', reftarget: '#in', targetvalue: 'v' }],
            },
          ])
        )
      ).toBe(true);
    });

    it('detects an action in a guided step', () => {
      expect(
        requiresGrafanaUi(guide([{ type: 'guided', content: 'tour', steps: [{ action: 'hover', reftarget: '#el' }] }]))
      ).toBe(true);
    });

    it('detects an action in EITHER conditional branch', () => {
      const inWhenTrue = guide([
        {
          type: 'conditional',
          conditions: ['has-datasource:prometheus'],
          whenTrue: [{ type: 'interactive', action: 'navigate', content: 'go', reftarget: '/x' }],
          whenFalse: [{ type: 'markdown', content: 'prose' }],
        },
      ]);
      const inWhenFalse = guide([
        {
          type: 'conditional',
          conditions: ['has-datasource:prometheus'],
          whenTrue: [{ type: 'markdown', content: 'prose' }],
          whenFalse: [{ type: 'interactive', action: 'button', content: 'go' }],
        },
      ]);
      expect(requiresGrafanaUi(inWhenTrue)).toBe(true);
      expect(requiresGrafanaUi(inWhenFalse)).toBe(true);
    });

    it('returns false when both conditional branches are prose', () => {
      expect(
        requiresGrafanaUi(
          guide([
            {
              type: 'conditional',
              conditions: ['has-datasource:prometheus'],
              whenTrue: [{ type: 'markdown', content: 'a' }],
              whenFalse: [{ type: 'markdown', content: 'b' }],
            },
          ])
        )
      ).toBe(false);
    });

    it('detects a deeply nested action (section > conditional > multistep)', () => {
      expect(
        requiresGrafanaUi(
          guide([
            {
              type: 'section',
              blocks: [
                {
                  type: 'conditional',
                  conditions: ['x'],
                  whenTrue: [],
                  whenFalse: [
                    { type: 'multistep', content: 'm', steps: [{ action: 'highlight', reftarget: '#deep' }] },
                  ],
                },
              ],
            },
          ])
        )
      ).toBe(true);
    });
  });

  describe('snippet-ref fail-safe', () => {
    it('treats a surviving snippet-ref as Grafana-driving (never hide an action)', () => {
      expect(requiresGrafanaUi(guide([{ type: 'snippet-ref', snippetId: 'maybe-interactive' }]))).toBe(true);
    });

    it('treats a snippet-ref nested in a section as Grafana-driving', () => {
      expect(requiresGrafanaUi(guide([{ type: 'section', blocks: [{ type: 'snippet-ref', snippetId: 's' }] }]))).toBe(
        true
      );
    });
  });
});
