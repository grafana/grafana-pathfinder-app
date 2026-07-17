import { countGuideSteps } from './count-guide-steps';
import type { JsonBlock } from '../types/json-guide.types';

const step = (content = 'do it'): JsonBlock => ({ type: 'interactive', action: 'noop', content });
const section = (blocks: JsonBlock[]): JsonBlock => ({ type: 'section', blocks });
const guide = (blocks: JsonBlock[]) => ({ blocks });

describe('countGuideSteps', () => {
  it('counts each of the 8 step block types as one step', () => {
    const blocks: JsonBlock[] = [
      { type: 'interactive', action: 'noop', content: 'read' },
      { type: 'multistep', content: 'multi', steps: [{ action: 'noop' }, { action: 'noop' }] },
      { type: 'guided', content: 'guided', steps: [{ action: 'noop' }] },
      { type: 'quiz', question: 'q?', choices: [{ id: 'a', text: 'A', correct: true }] },
      { type: 'terminal', command: 'ls', content: 'run' },
      { type: 'terminal-connect', content: 'connect' },
      { type: 'challenge', title: 't', brief: 'b', successCriteria: 'is-admin' },
      { type: 'code-block', reftarget: '.monaco', code: 'up' },
    ];
    expect(countGuideSteps(guide(blocks))).toBe(8);
  });

  it('counts multistep and guided as one step regardless of inner step count', () => {
    const blocks: JsonBlock[] = [
      { type: 'multistep', content: 'multi', steps: [{ action: 'noop' }, { action: 'noop' }, { action: 'noop' }] },
      { type: 'guided', content: 'guided', steps: [{ action: 'noop' }, { action: 'noop' }] },
    ];
    expect(countGuideSteps(guide(blocks))).toBe(2);
  });

  it('counts non-step block types as zero', () => {
    const blocks = [
      { type: 'markdown', content: '# hi' },
      { type: 'html', content: '<p>hi</p>' },
      { type: 'image', src: 'https://example.com/a.png' },
      { type: 'video', src: 'https://example.com/a.mp4' },
      { type: 'input', prompt: 'p', inputType: 'text', variableName: 'v' },
      { type: 'snippet-ref', snippetId: 'my-snippet' },
    ] as JsonBlock[];
    expect(countGuideSteps(guide(blocks))).toBe(0);
  });

  it('counts steps inside sections and mixed passive children', () => {
    const blocks: JsonBlock[] = [section([step(), step(), { type: 'markdown', content: 'note' }]), step()];
    expect(countGuideSteps(guide(blocks))).toBe(3);
  });

  it('recurses into nested sections', () => {
    expect(countGuideSteps(guide([section([section([step(), step()]), step()])]))).toBe(3);
  });

  it('counts conditional branches as zero even when both contain steps', () => {
    const blocks = [
      {
        type: 'conditional',
        conditions: ['is-admin'],
        whenTrue: [step(), section([step()])],
        whenFalse: [step()],
      },
    ] as JsonBlock[];
    expect(countGuideSteps(guide(blocks))).toBe(0);
  });

  it('counts legacy assistant wrapper blocks as zero', () => {
    const blocks = [{ type: 'assistant', blocks: [step(), step()] }] as JsonBlock[];
    expect(countGuideSteps(guide(blocks))).toBe(0);
  });

  it('counts an assistantEnabled step at top level but not inside a section', () => {
    const assistantStep: JsonBlock = { type: 'interactive', action: 'noop', content: 'x', assistantEnabled: true };
    expect(countGuideSteps(guide([assistantStep]))).toBe(1);
    expect(countGuideSteps(guide([section([assistantStep])]))).toBe(0);
    expect(countGuideSteps(guide([section([assistantStep, step()])]))).toBe(1);
  });

  it('counts an html-wrapped fallback guide as zero', () => {
    expect(countGuideSteps(guide([{ type: 'html', content: '<div class="interactive">legacy</div>' }]))).toBe(0);
  });

  it('counts an empty guide as zero', () => {
    expect(countGuideSteps(guide([]))).toBe(0);
  });
});
