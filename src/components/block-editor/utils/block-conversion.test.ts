/**
 * Tests for block conversion utilities
 *
 * Tests focus on generic behavior rather than every conversion pair.
 */

import {
  getAvailableConversions,
  getConversionWarning,
  convertBlockType,
  SOURCE_EXCLUDED_BLOCK_TYPES,
  TARGET_EXCLUDED_BLOCK_TYPES,
} from './block-conversion';
import { VALID_BLOCK_TYPES } from '../../../types/json-guide.schema';
import type { BlockType } from '../types';
import type { JsonBlock } from '../../../types/json-guide.types';

const ALL_BLOCK_TYPES = [...VALID_BLOCK_TYPES] as BlockType[];
const SOURCE_ONLY_BLOCK_TYPES: readonly BlockType[] = ['collapsible', 'assistant', 'snippet-ref'];

/**
 * The compile-time checks in `block-conversion.ts` prove that every block type
 * has a source and a target verdict; these assertions add the properties types
 * can't express and give a readable failure. Anchored on `VALID_BLOCK_TYPES` so
 * they track the block union rather than a restated count.
 */
describe('conversion eligibility registries', () => {
  it('excludes only real block types', () => {
    const unknown = [...SOURCE_EXCLUDED_BLOCK_TYPES, ...TARGET_EXCLUDED_BLOCK_TYPES].filter(
      (type) => !VALID_BLOCK_TYPES.has(type)
    );
    expect(unknown).toEqual([]);
  });

  it('offers no conversion at all from a source-excluded type', () => {
    const offered = SOURCE_EXCLUDED_BLOCK_TYPES.filter((type) => getAvailableConversions(type).length > 0);
    expect(offered).toEqual([]);
  });

  it('offers conversions from every type that is not source-excluded', () => {
    const silent = ALL_BLOCK_TYPES.filter(
      (type) => !SOURCE_EXCLUDED_BLOCK_TYPES.includes(type) && getAvailableConversions(type).length === 0
    );
    expect(silent).toEqual([]);
  });

  it('never offers a target-excluded type as a target', () => {
    const offered = ALL_BLOCK_TYPES.flatMap((source) =>
      getAvailableConversions(source).filter((target) => TARGET_EXCLUDED_BLOCK_TYPES.includes(target))
    );
    expect(offered).toEqual([]);
  });

  it('keeps legacy source-only block types eligible without offering them as targets', () => {
    expect(SOURCE_ONLY_BLOCK_TYPES.filter((type) => SOURCE_EXCLUDED_BLOCK_TYPES.includes(type))).toEqual([]);
    expect(SOURCE_ONLY_BLOCK_TYPES.filter((type) => !TARGET_EXCLUDED_BLOCK_TYPES.includes(type))).toEqual([]);
  });

  it('keeps html a valid target even though the palette excludes it', () => {
    expect(TARGET_EXCLUDED_BLOCK_TYPES).not.toContain('html');
  });
});

describe('getAvailableConversions', () => {
  describe('container types', () => {
    it('should return empty array for section type', () => {
      expect(getAvailableConversions('section')).toEqual([]);
    });

    it('should return empty array for conditional type', () => {
      expect(getAvailableConversions('conditional')).toEqual([]);
    });

    it('should return empty array for grot-guide type', () => {
      expect(getAvailableConversions('grot-guide')).toEqual([]);
    });
  });

  describe('non-container types', () => {
    it('should return all non-container types except the source type', () => {
      const result = getAvailableConversions('markdown');

      // Should not include source type
      expect(result).not.toContain('markdown');

      // Should not include container types
      expect(result).not.toContain('section');
      expect(result).not.toContain('conditional');

      // Should include other non-container types
      expect(result).toContain('html');
      expect(result).toContain('image');
      expect(result).toContain('video');
      expect(result).toContain('interactive');
      expect(result).toContain('multistep');
      expect(result).toContain('guided');
      expect(result).toContain('quiz');
      expect(result).toContain('input');
    });

    // This order is user-visible in the switch-type menu and emerges from TARGET_EXCLUSION_REASONS key order.
    it('should offer targets in the switch-type menu order', () => {
      expect(getAvailableConversions('markdown')).toEqual([
        'html',
        'image',
        'video',
        'interactive',
        'multistep',
        'guided',
        'quiz',
        'input',
        'terminal',
        'terminal-connect',
        'challenge',
        'code-block',
      ]);
    });

    it('should offer every non-excluded target except the source, for every eligible source', () => {
      const eligibleSources = ALL_BLOCK_TYPES.filter((type) => !SOURCE_EXCLUDED_BLOCK_TYPES.includes(type));

      for (const source of eligibleSources) {
        const expected = ALL_BLOCK_TYPES.filter(
          (target) => target !== source && !TARGET_EXCLUDED_BLOCK_TYPES.includes(target)
        );
        expect([...getAvailableConversions(source)].sort()).toEqual([...expected].sort());
      }
    });
  });
});

describe('getConversionWarning', () => {
  describe('no data loss scenarios', () => {
    it('should return null when converting markdown to html (content maps)', () => {
      const source: JsonBlock = { type: 'markdown', content: 'hello' };
      expect(getConversionWarning(source, 'html')).toBeNull();
    });

    it('should return null when only common fields are present', () => {
      const source: JsonBlock = {
        type: 'markdown',
        content: 'hello',
      };
      expect(getConversionWarning(source, 'interactive')).toBeNull();
    });
  });

  describe('data loss scenarios', () => {
    it('should warn about lost fields when converting quiz to markdown', () => {
      const source: JsonBlock = {
        type: 'quiz',
        question: 'What is 2+2?',
        choices: [
          { id: 'a', text: '3' },
          { id: 'b', text: '4', correct: true },
        ],
        multiSelect: true,
      };
      const warning = getConversionWarning(source, 'markdown');

      expect(warning).not.toBeNull();
      expect(warning!.lostFields).toContain('choices');
      expect(warning!.lostFields).toContain('multiSelect');
    });

    it('should warn about lost fields when converting interactive to markdown', () => {
      const source: JsonBlock = {
        type: 'interactive',
        action: 'button',
        reftarget: '[data-testid="btn"]',
        content: 'Click the button',
        showMe: true,
        doIt: true,
      };
      const warning = getConversionWarning(source, 'markdown');

      expect(warning).not.toBeNull();
      expect(warning!.lostFields).toContain('action');
      expect(warning!.lostFields).toContain('reftarget');
      expect(warning!.lostFields).toContain('showMe');
      expect(warning!.lostFields).toContain('doIt');
    });

    it('should warn about lost fields when converting image to interactive', () => {
      const source: JsonBlock = {
        type: 'image',
        src: 'https://example.com/img.png',
        alt: 'Test image',
        width: 800,
        height: 600,
      };
      const warning = getConversionWarning(source, 'interactive');

      expect(warning).not.toBeNull();
      expect(warning!.lostFields).toContain('src');
      expect(warning!.lostFields).toContain('alt');
      expect(warning!.lostFields).toContain('width');
      expect(warning!.lostFields).toContain('height');
    });

    // `challenge` had no KNOWN_FIELDS entry, so this returned null and the
    // switch happened with no confirmation, silently dropping the quiz.
    it('should warn about lost fields when converting quiz to challenge', () => {
      const source: JsonBlock = {
        type: 'quiz',
        question: 'What is 2+2?',
        choices: [{ id: 'b', text: '4', correct: true }],
        multiSelect: true,
        id: 'q1',
      };
      const warning = getConversionWarning(source, 'challenge');

      expect(warning).not.toBeNull();
      expect(warning!.lostFields.sort()).toEqual(['choices', 'multiSelect']);
    });
  });

  describe('common fields handling', () => {
    it('should not include common fields in lost fields', () => {
      const source: JsonBlock = {
        type: 'interactive',
        action: 'button',
        reftarget: '[data-testid="btn"]',
        content: 'Test',
        requirements: ['is-admin', 'is-editor'],
        objectives: ['obj1'],
        skippable: true,
      };
      const warning = getConversionWarning(source, 'markdown');

      expect(warning).not.toBeNull();
      // Common fields should NOT be in lost fields
      expect(warning!.lostFields).not.toContain('requirements');
      expect(warning!.lostFields).not.toContain('objectives');
      expect(warning!.lostFields).not.toContain('skippable');
    });
  });
});

describe('convertBlockType', () => {
  describe('same type conversion', () => {
    it('should return the same block when types match', () => {
      const source: JsonBlock = { type: 'markdown', content: 'hello' };
      const result = convertBlockType(source, 'markdown');
      expect(result).toBe(source);
    });
  });

  describe('excluded type restrictions', () => {
    const markdown: JsonBlock = { type: 'markdown', content: 'hello' };

    const excludedSources: Array<[BlockType, JsonBlock]> = [
      ['section', { type: 'section', blocks: [] }],
      ['conditional', { type: 'conditional', conditions: ['test'], whenTrue: [], whenFalse: [] }],
      [
        'grot-guide',
        {
          type: 'grot-guide',
          welcome: { title: 'W', body: 'B', ctas: [{ text: 'Start', screenId: 'r' }] },
          screens: [{ type: 'result', id: 'r', title: 'T', body: 'B' }],
        },
      ],
    ];

    it.each(excludedSources)('should throw when converting from %s, naming the reason', (sourceType, source) => {
      expect(() => convertBlockType(source, 'markdown')).toThrow(new RegExp(`Cannot convert from a ${sourceType}`));
    });

    it('covers every source-excluded type', () => {
      const covered = excludedSources.map(([type]) => type);
      expect([...SOURCE_EXCLUDED_BLOCK_TYPES].sort()).toEqual([...covered].sort());
    });

    it.each([...TARGET_EXCLUDED_BLOCK_TYPES])('should throw when converting to %s, naming the reason', (targetType) => {
      expect(() => convertBlockType(markdown, targetType)).toThrow(new RegExp(`Cannot convert to a ${targetType}`));
    });

    /**
     * The only conversions this registry rejects that the pre-#1577 guard allowed:
     * that guard rejected container targets only, so both directions used to
     * succeed by copying `blocks`. Direct-API-only — `getAvailableConversions`
     * never offered `collapsible` or `assistant` as a target, and no form exposes
     * the switch for those sources.
     */
    const directApiOnlyPairs: Array<[BlockType, BlockType, JsonBlock]> = [
      ['assistant', 'collapsible', { type: 'assistant', blocks: [] }],
      ['collapsible', 'assistant', { type: 'collapsible', title: 'T', blocks: [] }],
    ];

    it.each(directApiOnlyPairs)('should throw on the %s to %s direct-API conversion', (_source, targetType, source) => {
      expect(getAvailableConversions(source.type as BlockType)).not.toContain(targetType);
      expect(() => convertBlockType(source, targetType)).toThrow(new RegExp(`Cannot convert to a ${targetType}`));
    });
  });

  describe('content field mapping', () => {
    it('should map content from markdown to html', () => {
      const source: JsonBlock = { type: 'markdown', content: 'Hello world' };
      const result = convertBlockType(source, 'html');
      expect(result.type).toBe('html');
      expect((result as { content: string }).content).toBe('Hello world');
    });

    it('should map content from markdown to interactive', () => {
      const source: JsonBlock = { type: 'markdown', content: 'Click the button' };
      const result = convertBlockType(source, 'interactive');
      expect(result.type).toBe('interactive');
      expect((result as { content: string }).content).toBe('Click the button');
    });

    it('should map content to question when converting to quiz', () => {
      const source: JsonBlock = { type: 'markdown', content: 'What is 2+2?' };
      const result = convertBlockType(source, 'quiz');
      expect(result.type).toBe('quiz');
      expect((result as { question: string }).question).toBe('What is 2+2?');
    });

    it('should map question to prompt when converting quiz to input', () => {
      const source: JsonBlock = {
        type: 'quiz',
        question: 'Enter your name',
        choices: [{ id: 'a', text: 'A', correct: true }],
      };
      const result = convertBlockType(source, 'input');
      expect(result.type).toBe('input');
      expect((result as { prompt: string }).prompt).toBe('Enter your name');
    });
  });

  describe('common fields preservation', () => {
    it('should preserve requirements field', () => {
      // Using interactive -> multistep since both support requirements
      const source: JsonBlock = {
        type: 'interactive',
        action: 'noop',
        content: 'Test',
        requirements: ['is-admin', 'is-editor'],
      };
      const result = convertBlockType(source, 'multistep');
      expect((result as { requirements?: string[] }).requirements).toEqual(['is-admin', 'is-editor']);
    });

    it('should preserve objectives field', () => {
      const source: JsonBlock = {
        type: 'interactive',
        action: 'noop',
        content: 'Test',
        objectives: ['obj1'],
      };
      const result = convertBlockType(source, 'guided');
      expect((result as { objectives?: string[] }).objectives).toEqual(['obj1']);
    });

    it('should preserve skippable field', () => {
      const source: JsonBlock = {
        type: 'interactive',
        action: 'noop',
        content: 'Test',
        skippable: true,
      };
      const result = convertBlockType(source, 'multistep');
      expect((result as { skippable?: boolean }).skippable).toBe(true);
    });
  });

  describe('required defaults', () => {
    it('should apply default choices when converting to quiz', () => {
      const source: JsonBlock = { type: 'markdown', content: 'Question?' };
      const result = convertBlockType(source, 'quiz');
      const quizResult = result as { choices: Array<{ id: string; text: string; correct?: boolean }> };
      expect(quizResult.choices).toBeDefined();
      expect(quizResult.choices.length).toBeGreaterThan(0);
    });

    it('should apply default inputType and variableName when converting to input', () => {
      const source: JsonBlock = { type: 'markdown', content: 'Enter value' };
      const result = convertBlockType(source, 'input');
      const inputResult = result as { inputType: string; variableName: string };
      expect(inputResult.inputType).toBe('text');
      expect(inputResult.variableName).toBe('userInput');
    });

    it('should apply placeholder URL when converting to image', () => {
      const source: JsonBlock = { type: 'markdown', content: 'Test' };
      const result = convertBlockType(source, 'image');
      const imageResult = result as { src: string; alt?: string };
      expect(imageResult.src).toBe('https://placeholder.invalid/replace-me');
      expect(imageResult.alt).toBe('');
    });

    it('should apply placeholder URL when converting to video', () => {
      const source: JsonBlock = { type: 'markdown', content: 'Test' };
      const result = convertBlockType(source, 'video');
      const videoResult = result as { src: string };
      expect(videoResult.src).toBe('https://placeholder.invalid/replace-me');
    });

    it('should apply default action when converting to interactive', () => {
      const source: JsonBlock = { type: 'markdown', content: 'Test' };
      const result = convertBlockType(source, 'interactive');
      const interactiveResult = result as { action: string };
      expect(interactiveResult.action).toBe('noop');
    });

    it('should apply default steps when converting to multistep', () => {
      const source: JsonBlock = { type: 'markdown', content: 'Test' };
      const result = convertBlockType(source, 'multistep');
      const multistepResult = result as { steps: Array<{ action: string }> };
      expect(multistepResult.steps).toBeDefined();
      expect(multistepResult.steps.length).toBeGreaterThan(0);
      expect(multistepResult.steps[0]!.action).toBe('noop');
    });

    it('should apply default steps when converting to guided', () => {
      const source: JsonBlock = { type: 'markdown', content: 'Test' };
      const result = convertBlockType(source, 'guided');
      const guidedResult = result as { steps: Array<{ action: string }> };
      expect(guidedResult.steps).toBeDefined();
      expect(guidedResult.steps.length).toBeGreaterThan(0);
      expect(guidedResult.steps[0]!.action).toBe('noop');
    });
  });

  describe('shared field copying', () => {
    it('should copy fields that exist in both source and target schemas', () => {
      // Both interactive and guided support completeEarly
      const source: JsonBlock = {
        type: 'interactive',
        action: 'noop',
        content: 'Test',
        completeEarly: true,
      };
      const result = convertBlockType(source, 'guided');
      expect((result as { completeEarly?: boolean }).completeEarly).toBe(true);
    });

    it('should not copy fields that only exist in source schema', () => {
      // showMe/doIt only exist on interactive, not on html
      const source: JsonBlock = {
        type: 'interactive',
        action: 'noop',
        content: 'Test',
        showMe: true,
        doIt: true,
      };
      const result = convertBlockType(source, 'html');
      expect((result as unknown as Record<string, unknown>).showMe).toBeUndefined();
      expect((result as unknown as Record<string, unknown>).doIt).toBeUndefined();
    });

    // Without a KNOWN_FIELDS entry for the target, the shared-field copy was
    // skipped entirely — dropping `id`, which drives completion tracking.
    it('should copy shared fields when converting markdown to challenge', () => {
      const source: JsonBlock = {
        type: 'markdown',
        content: 'Solve it',
        id: 'm1',
        authorNote: 'n',
      };
      const result = convertBlockType(source, 'challenge') as unknown as Record<string, unknown>;

      expect(result.id).toBe('m1');
      expect(result.authorNote).toBe('n');
      expect(result.brief).toBe('Solve it');
    });
  });

  describe('schema validation', () => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
      consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
    });

    const SAMPLE_BLOCKS = {
      markdown: { type: 'markdown', content: 'Sample content' },
      html: { type: 'html', content: '<p>Sample content</p>' },
      image: { type: 'image', src: 'https://example.com/i.png', alt: 'a' },
      video: { type: 'video', src: 'https://example.com/v.mp4' },
      interactive: { type: 'interactive', action: 'noop', content: 'Sample content' },
      multistep: { type: 'multistep', content: 'Sample content', steps: [{ action: 'noop' }] },
      guided: { type: 'guided', content: 'Sample content', steps: [{ action: 'noop' }] },
      quiz: { type: 'quiz', question: 'Sample content', choices: [{ id: 'a', text: 'A', correct: true }] },
      input: { type: 'input', prompt: 'Sample content', inputType: 'text', variableName: 'v' },
      terminal: { type: 'terminal', content: 'Sample content', command: 'echo hi' },
      'terminal-connect': { type: 'terminal-connect', content: 'Sample content' },
      challenge: { type: 'challenge', title: 'T', brief: 'Sample content', successCriteria: 'coda-exit-zero:true' },
      'code-block': { type: 'code-block', reftarget: "div[data-testid='x']", code: 'x', content: 'Sample content' },
      collapsible: { type: 'collapsible', title: 'T', blocks: [] },
      assistant: { type: 'assistant', blocks: [] },
      'snippet-ref': { type: 'snippet-ref', snippetId: 'some-snippet' },
    } satisfies Partial<Record<BlockType, JsonBlock>>;

    const sampleEntries = Object.entries(SAMPLE_BLOCKS) as Array<[BlockType, JsonBlock]>;

    /**
     * Sources with no `CONTENT_FIELDS` entry — `image`, `video`, `collapsible`,
     * `assistant` and `snippet-ref` — carry no text into a target whose required
     * text field has no `REQUIRED_DEFAULTS` fallback, so the conversion throws.
     * Pinned here rather than fixed, so a fix has to move this list deliberately;
     * the `image`/`video` symptom is tracked as
     * https://github.com/grafana/grafana-pathfinder-app/issues/1575.
     */
    const CONTENTLESS_SOURCE_FAILURES: Partial<Record<BlockType, readonly BlockType[]>> = {
      image: ['markdown', 'html', 'interactive', 'quiz', 'input', 'terminal', 'challenge'],
      video: ['markdown', 'html', 'interactive', 'quiz', 'input', 'terminal', 'challenge'],
      collapsible: ['markdown', 'html', 'interactive', 'quiz', 'input', 'terminal', 'challenge'],
      assistant: ['markdown', 'html', 'interactive', 'quiz', 'input', 'terminal', 'challenge'],
      'snippet-ref': ['markdown', 'html', 'interactive', 'quiz', 'input', 'terminal', 'challenge'],
    };

    it('samples every convertible source type', () => {
      const missing = ALL_BLOCK_TYPES.filter(
        (type) => !SOURCE_EXCLUDED_BLOCK_TYPES.includes(type) && !sampleEntries.some(([sampled]) => sampled === type)
      );
      expect(missing).toEqual([]);
    });

    it.each(sampleEntries)('should convert %s to every available target', (sourceType, source) => {
      const expectedFailures = CONTENTLESS_SOURCE_FAILURES[sourceType] ?? [];
      const targets = getAvailableConversions(sourceType);
      expect(targets.length).toBeGreaterThan(0);

      for (const target of targets) {
        if (expectedFailures.includes(target)) {
          expect(() => convertBlockType(source, target)).toThrow(/failed validation/);
        } else {
          expect(convertBlockType(source, target).type).toBe(target);
        }
      }
    });

    it('should convert image to terminal-connect without throwing (regression #619)', () => {
      const source: JsonBlock = { type: 'image', src: 'https://example.com/img.png', alt: 'alt text' };
      const result = convertBlockType(source, 'terminal-connect');
      expect(result.type).toBe('terminal-connect');
    });

    it('should convert video to terminal-connect without throwing (regression #619)', () => {
      const source: JsonBlock = { type: 'video', src: 'https://example.com/vid.mp4' };
      const result = convertBlockType(source, 'terminal-connect');
      expect(result.type).toBe('terminal-connect');
    });

    it('should convert code-block without content to terminal-connect without throwing (regression #619)', () => {
      const source: JsonBlock = {
        type: 'code-block',
        reftarget: "div[data-testid='data-testid Code editor container']",
        code: '',
      };
      const result = convertBlockType(source, 'terminal-connect');
      expect(result.type).toBe('terminal-connect');
    });
  });
});
