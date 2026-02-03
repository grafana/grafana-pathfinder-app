/**
 * JSON Round-trip Conversion Tests
 *
 * Tests that validate JSON guide serialization and deserialization
 * preserve all data correctly. This ensures the JSON editor can
 * serialize blocks to JSON and parse them back without data loss.
 */

import { parseAndValidateGuide } from './block-import';
import type {
  JsonGuide,
  JsonSectionBlock,
  JsonConditionalBlock,
  JsonMultistepBlock,
  JsonGuidedBlock,
  JsonMarkdownBlock,
  JsonInteractiveBlock,
  JsonImageBlock,
  JsonVideoBlock,
  JsonQuizBlock,
  JsonInputBlock,
} from '../../../types/json-guide.types';

/**
 * Round-trip test helper: serialize a guide to JSON and parse it back
 */
function roundTrip(guide: JsonGuide) {
  const json = JSON.stringify(guide, null, 2);
  return { result: parseAndValidateGuide(json), json };
}

describe('JSON Round-trip Conversion', () => {
  const baseGuide: JsonGuide = { id: 'test', title: 'Test', blocks: [] };

  // ============ BASIC BLOCKS ============

  describe('basic blocks', () => {
    test('markdown preserves content', () => {
      const guide: JsonGuide = {
        ...baseGuide,
        blocks: [{ type: 'markdown', content: '# Hello World\n\nThis is **bold** and *italic*.' }],
      };
      const { result } = roundTrip(guide);
      expect(result.isValid).toBe(true);
      expect(result.guide?.blocks).toHaveLength(1);
      const block = result.guide?.blocks[0] as JsonMarkdownBlock;
      expect(block.type).toBe('markdown');
      expect(block.content).toBe('# Hello World\n\nThis is **bold** and *italic*.');
    });

    test('html preserves content', () => {
      const guide: JsonGuide = {
        ...baseGuide,
        blocks: [{ type: 'html', content: '<p>Hello <strong>World</strong></p>' }],
      };
      const { result } = roundTrip(guide);
      expect(result.isValid).toBe(true);
      expect(result.guide?.blocks[0]).toEqual({ type: 'html', content: '<p>Hello <strong>World</strong></p>' });
    });

    test('image preserves all fields', () => {
      const guide: JsonGuide = {
        ...baseGuide,
        blocks: [
          {
            type: 'image',
            src: 'https://example.com/image.png',
            alt: 'Example image',
            width: 800,
            height: 600,
          },
        ],
      };
      const { result } = roundTrip(guide);
      expect(result.isValid).toBe(true);
      const block = result.guide?.blocks[0] as JsonImageBlock;
      expect(block.type).toBe('image');
      expect(block.src).toBe('https://example.com/image.png');
      expect(block.alt).toBe('Example image');
      expect(block.width).toBe(800);
      expect(block.height).toBe(600);
    });

    test('video preserves all fields', () => {
      const guide: JsonGuide = {
        ...baseGuide,
        blocks: [
          {
            type: 'video',
            src: 'https://youtube.com/watch?v=abc123',
            provider: 'youtube',
            title: 'Tutorial Video',
            start: 30,
            end: 120,
          },
        ],
      };
      const { result } = roundTrip(guide);
      expect(result.isValid).toBe(true);
      const block = result.guide?.blocks[0] as JsonVideoBlock;
      expect(block.type).toBe('video');
      expect(block.src).toBe('https://youtube.com/watch?v=abc123');
      expect(block.provider).toBe('youtube');
      expect(block.title).toBe('Tutorial Video');
      expect(block.start).toBe(30);
      expect(block.end).toBe(120);
    });
  });

  // ============ INTERACTIVE BLOCKS ============

  describe('interactive blocks', () => {
    test('interactive preserves all fields', () => {
      const guide: JsonGuide = {
        ...baseGuide,
        blocks: [
          {
            type: 'interactive',
            action: 'button',
            reftarget: '[data-testid="submit-btn"]',
            content: 'Click the submit button',
            tooltip: 'This will submit the form',
            requirements: ['on-page:/dashboard'],
            objectives: ['clicked-submit'],
            skippable: true,
            hint: 'Look for the blue button',
          },
        ],
      };
      const { result } = roundTrip(guide);
      expect(result.isValid).toBe(true);
      const block = result.guide?.blocks[0] as JsonInteractiveBlock;
      expect(block.type).toBe('interactive');
      expect(block.action).toBe('button');
      expect(block.reftarget).toBe('[data-testid="submit-btn"]');
      expect(block.content).toBe('Click the submit button');
      expect(block.tooltip).toBe('This will submit the form');
      expect(block.requirements).toEqual(['on-page:/dashboard']);
      expect(block.objectives).toEqual(['clicked-submit']);
      expect(block.skippable).toBe(true);
      expect(block.hint).toBe('Look for the blue button');
    });

    test('formfill preserves targetvalue and validation fields', () => {
      const guide: JsonGuide = {
        ...baseGuide,
        blocks: [
          {
            type: 'interactive',
            action: 'formfill',
            reftarget: 'input[name="email"]',
            targetvalue: '^[a-z]+@example\\.com$',
            content: 'Enter your email',
            validateInput: true,
            formHint: 'Must be a valid example.com email',
          },
        ],
      };
      const { result } = roundTrip(guide);
      expect(result.isValid).toBe(true);
      const block = result.guide?.blocks[0] as JsonInteractiveBlock;
      expect(block.action).toBe('formfill');
      expect(block.targetvalue).toBe('^[a-z]+@example\\.com$');
      expect(block.validateInput).toBe(true);
      expect(block.formHint).toBe('Must be a valid example.com email');
    });

    test('interactive preserves execution control fields', () => {
      const guide: JsonGuide = {
        ...baseGuide,
        blocks: [
          {
            type: 'interactive',
            action: 'navigate',
            reftarget: 'a[href="/dashboard"]',
            content: 'Navigate to dashboard',
            completeEarly: true,
            verify: 'on-page:/dashboard',
            lazyRender: true,
            scrollContainer: '.main-content',
          },
        ],
      };
      const { result } = roundTrip(guide);
      expect(result.isValid).toBe(true);
      const block = result.guide?.blocks[0] as JsonInteractiveBlock;
      expect(block.completeEarly).toBe(true);
      expect(block.verify).toBe('on-page:/dashboard');
      expect(block.lazyRender).toBe(true);
      expect(block.scrollContainer).toBe('.main-content');
    });

    test('interactive preserves button visibility fields', () => {
      const guide: JsonGuide = {
        ...baseGuide,
        blocks: [
          {
            type: 'interactive',
            action: 'highlight',
            reftarget: '.sidebar',
            content: 'Notice the sidebar',
            showMe: true,
            doIt: false,
          },
        ],
      };
      const { result } = roundTrip(guide);
      expect(result.isValid).toBe(true);
      const block = result.guide?.blocks[0] as JsonInteractiveBlock;
      expect(block.showMe).toBe(true);
      expect(block.doIt).toBe(false);
    });
  });

  // ============ SECTION NESTING ============

  describe('section nesting', () => {
    test('section with nested blocks', () => {
      const guide: JsonGuide = {
        ...baseGuide,
        blocks: [
          {
            type: 'section',
            title: 'Getting Started',
            blocks: [
              { type: 'markdown', content: '# Introduction' },
              { type: 'interactive', action: 'highlight', reftarget: '.nav', content: 'Look here' },
            ],
            requirements: ['on-page:/'],
            objectives: ['completed-intro'],
          },
        ],
      };
      const { result } = roundTrip(guide);
      expect(result.isValid).toBe(true);
      const section = result.guide?.blocks[0] as JsonSectionBlock;
      expect(section.type).toBe('section');
      expect(section.title).toBe('Getting Started');
      expect(section.blocks).toHaveLength(2);
      expect(section.requirements).toEqual(['on-page:/']);
      expect(section.objectives).toEqual(['completed-intro']);
    });

    test('deeply nested sections', () => {
      const guide: JsonGuide = {
        ...baseGuide,
        blocks: [
          {
            type: 'section',
            title: 'Outer Section',
            blocks: [
              {
                type: 'section',
                title: 'Inner Section',
                blocks: [{ type: 'markdown', content: 'Deeply nested' }],
              },
            ],
          },
        ],
      };
      const { result } = roundTrip(guide);
      expect(result.isValid).toBe(true);
      const outer = result.guide?.blocks[0] as JsonSectionBlock;
      const inner = outer.blocks[0] as JsonSectionBlock;
      expect(inner.title).toBe('Inner Section');
      expect((inner.blocks[0] as JsonMarkdownBlock).content).toBe('Deeply nested');
    });
  });

  // ============ CONDITIONAL BLOCKS ============

  describe('conditional blocks', () => {
    test('conditional with branches', () => {
      const guide: JsonGuide = {
        ...baseGuide,
        blocks: [
          {
            type: 'conditional',
            conditions: ['context:isCloud'],
            whenTrue: [{ type: 'markdown', content: 'Cloud-specific content' }],
            whenFalse: [{ type: 'markdown', content: 'OSS-specific content' }],
            description: 'Show different content based on deployment type',
          },
        ],
      };
      const { result } = roundTrip(guide);
      expect(result.isValid).toBe(true);
      const conditional = result.guide?.blocks[0] as JsonConditionalBlock;
      expect(conditional.type).toBe('conditional');
      expect(conditional.conditions).toEqual(['context:isCloud']);
      expect(conditional.whenTrue).toHaveLength(1);
      expect(conditional.whenFalse).toHaveLength(1);
      expect(conditional.description).toBe('Show different content based on deployment type');
    });

    test('conditional with section display mode', () => {
      const guide: JsonGuide = {
        ...baseGuide,
        blocks: [
          {
            type: 'conditional',
            conditions: ['has-datasource:prometheus'],
            whenTrue: [{ type: 'markdown', content: 'Prometheus guide' }],
            whenFalse: [{ type: 'markdown', content: 'Please add Prometheus' }],
            display: 'section',
            whenTrueSectionConfig: {
              title: 'Prometheus Setup',
              requirements: ['on-page:/connections'],
            },
            whenFalseSectionConfig: {
              title: 'Add Data Source',
            },
          },
        ],
      };
      const { result } = roundTrip(guide);
      expect(result.isValid).toBe(true);
      const conditional = result.guide?.blocks[0] as JsonConditionalBlock;
      expect(conditional.display).toBe('section');
      expect(conditional.whenTrueSectionConfig?.title).toBe('Prometheus Setup');
      expect(conditional.whenFalseSectionConfig?.title).toBe('Add Data Source');
    });
  });

  // ============ MULTISTEP AND GUIDED BLOCKS ============

  describe('multistep blocks', () => {
    test('multistep preserves steps', () => {
      const guide: JsonGuide = {
        ...baseGuide,
        blocks: [
          {
            type: 'multistep',
            content: 'Follow these steps to configure the dashboard',
            steps: [
              { action: 'button', reftarget: '.add-panel', tooltip: 'Click to add panel' },
              { action: 'formfill', reftarget: 'input[name="title"]', targetvalue: 'My Panel' },
              { action: 'button', reftarget: '.save', tooltip: 'Save changes' },
            ],
            requirements: ['on-page:/dashboard'],
            objectives: ['dashboard-configured'],
            skippable: true,
          },
        ],
      };
      const { result } = roundTrip(guide);
      expect(result.isValid).toBe(true);
      const multistep = result.guide?.blocks[0] as JsonMultistepBlock;
      expect(multistep.type).toBe('multistep');
      expect(multistep.content).toBe('Follow these steps to configure the dashboard');
      expect(multistep.steps).toHaveLength(3);
      expect(multistep.steps[0].action).toBe('button');
      expect(multistep.steps[1].targetvalue).toBe('My Panel');
      expect(multistep.requirements).toEqual(['on-page:/dashboard']);
    });

    test('multistep steps with all optional fields', () => {
      const guide: JsonGuide = {
        ...baseGuide,
        blocks: [
          {
            type: 'multistep',
            content: 'Steps with all fields',
            steps: [
              {
                action: 'formfill',
                reftarget: 'input[name="search"]',
                targetvalue: 'test query',
                requirements: ['element-visible:input'],
                tooltip: 'Enter search term',
                description: 'Search for something',
                skippable: false,
                formHint: 'Must match pattern',
                validateInput: true,
                lazyRender: true,
                scrollContainer: '.results',
              },
            ],
          },
        ],
      };
      const { result } = roundTrip(guide);
      expect(result.isValid).toBe(true);
      const multistep = result.guide?.blocks[0] as JsonMultistepBlock;
      const step = multistep.steps[0];
      expect(step.requirements).toEqual(['element-visible:input']);
      expect(step.tooltip).toBe('Enter search term');
      expect(step.description).toBe('Search for something');
      expect(step.validateInput).toBe(true);
      expect(step.lazyRender).toBe(true);
    });
  });

  describe('guided blocks', () => {
    test('guided preserves steps', () => {
      const guide: JsonGuide = {
        ...baseGuide,
        blocks: [
          {
            type: 'guided',
            content: 'Follow along with these steps',
            steps: [
              { action: 'button', reftarget: '[data-testid="next"]', description: 'Click next' },
              { action: 'formfill', reftarget: 'input', targetvalue: 'value', description: 'Fill the form' },
            ],
            stepTimeout: 60000,
            completeEarly: true,
          },
        ],
      };
      const { result } = roundTrip(guide);
      expect(result.isValid).toBe(true);
      const guided = result.guide?.blocks[0] as JsonGuidedBlock;
      expect(guided.type).toBe('guided');
      expect(guided.steps).toHaveLength(2);
      expect(guided.stepTimeout).toBe(60000);
      expect(guided.completeEarly).toBe(true);
    });
  });

  // ============ QUIZ AND INPUT BLOCKS ============

  describe('quiz blocks', () => {
    test('quiz preserves all fields', () => {
      const guide: JsonGuide = {
        ...baseGuide,
        blocks: [
          {
            type: 'quiz',
            question: 'What is the capital of France?',
            choices: [
              { id: 'a', text: 'London', hint: 'This is the capital of the UK' },
              { id: 'b', text: 'Paris', correct: true },
              { id: 'c', text: 'Berlin', hint: 'This is the capital of Germany' },
            ],
            multiSelect: false,
            completionMode: 'max-attempts',
            maxAttempts: 3,
            requirements: ['section-complete:intro'],
            skippable: true,
          },
        ],
      };
      const { result } = roundTrip(guide);
      expect(result.isValid).toBe(true);
      const quiz = result.guide?.blocks[0] as JsonQuizBlock;
      expect(quiz.type).toBe('quiz');
      expect(quiz.question).toBe('What is the capital of France?');
      expect(quiz.choices).toHaveLength(3);
      expect(quiz.choices[1].correct).toBe(true);
      expect(quiz.completionMode).toBe('max-attempts');
      expect(quiz.maxAttempts).toBe(3);
    });
  });

  describe('input blocks', () => {
    test('input preserves all fields', () => {
      const guide: JsonGuide = {
        ...baseGuide,
        blocks: [
          {
            type: 'input',
            prompt: 'Enter your datasource name',
            inputType: 'text',
            variableName: 'datasourceName',
            placeholder: 'e.g., prometheus-1',
            defaultValue: 'my-datasource',
            required: true,
            pattern: '^[a-z0-9-]+$',
            validationMessage: 'Must be lowercase alphanumeric with dashes',
            requirements: ['on-page:/connections'],
            skippable: false,
          },
        ],
      };
      const { result } = roundTrip(guide);
      expect(result.isValid).toBe(true);
      const input = result.guide?.blocks[0] as JsonInputBlock;
      expect(input.type).toBe('input');
      expect(input.prompt).toBe('Enter your datasource name');
      expect(input.inputType).toBe('text');
      expect(input.variableName).toBe('datasourceName');
      expect(input.pattern).toBe('^[a-z0-9-]+$');
    });

    test('boolean input preserves checkbox fields', () => {
      const guide: JsonGuide = {
        ...baseGuide,
        blocks: [
          {
            type: 'input',
            prompt: 'Accept terms?',
            inputType: 'boolean',
            variableName: 'termsAccepted',
            checkboxLabel: 'I accept the terms and conditions',
            defaultValue: false,
            required: true,
          },
        ],
      };
      const { result } = roundTrip(guide);
      expect(result.isValid).toBe(true);
      const input = result.guide?.blocks[0] as JsonInputBlock;
      expect(input.inputType).toBe('boolean');
      expect(input.checkboxLabel).toBe('I accept the terms and conditions');
      expect(input.defaultValue).toBe(false);
    });

    test('datasource input preserves filter', () => {
      const guide: JsonGuide = {
        ...baseGuide,
        blocks: [
          {
            type: 'input',
            prompt: 'Select a Prometheus datasource',
            inputType: 'datasource',
            variableName: 'promDs',
            datasourceFilter: 'prometheus',
          },
        ],
      };
      const { result } = roundTrip(guide);
      expect(result.isValid).toBe(true);
      const input = result.guide?.blocks[0] as JsonInputBlock;
      expect(input.inputType).toBe('datasource');
      expect(input.datasourceFilter).toBe('prometheus');
    });
  });

  // ============ INVALID JSON ============

  describe('invalid JSON handling', () => {
    test('malformed JSON returns error', () => {
      const result = parseAndValidateGuide('{ invalid json }');
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test('missing id returns error', () => {
      const result = parseAndValidateGuide(JSON.stringify({ title: 'Test', blocks: [] }));
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test('missing title returns error', () => {
      const result = parseAndValidateGuide(JSON.stringify({ id: 'test', blocks: [] }));
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test('missing blocks returns error', () => {
      const result = parseAndValidateGuide(JSON.stringify({ id: 'test', title: 'Test' }));
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test('invalid block type returns error', () => {
      const result = parseAndValidateGuide(
        JSON.stringify({
          id: 'test',
          title: 'Test',
          blocks: [{ type: 'invalid-block-type' }],
        })
      );
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test('null returns error', () => {
      const result = parseAndValidateGuide('null');
      expect(result.isValid).toBe(false);
    });

    test('array returns error', () => {
      const result = parseAndValidateGuide('[]');
      expect(result.isValid).toBe(false);
    });
  });

  // ============ EDGE CASES ============

  describe('edge cases', () => {
    test('unicode content preserved', () => {
      const guide: JsonGuide = {
        ...baseGuide,
        title: '日本語ガイド',
        blocks: [{ type: 'markdown', content: '# こんにちは 🎉\n\nEmoji test: 👍 ✅ 🚀' }],
      };
      const { result } = roundTrip(guide);
      expect(result.isValid).toBe(true);
      expect(result.guide?.title).toBe('日本語ガイド');
      const block = result.guide?.blocks[0] as JsonMarkdownBlock;
      expect(block.content).toContain('こんにちは');
      expect(block.content).toContain('🎉');
    });

    test('special characters in selectors preserved', () => {
      const guide: JsonGuide = {
        ...baseGuide,
        blocks: [
          {
            type: 'interactive',
            action: 'button',
            reftarget: '[data-testid="btn:special-chars"] > span.class\\.name',
            content: 'Click button',
          },
        ],
      };
      const { result } = roundTrip(guide);
      expect(result.isValid).toBe(true);
      const block = result.guide?.blocks[0] as JsonInteractiveBlock;
      expect(block.reftarget).toBe('[data-testid="btn:special-chars"] > span.class\\.name');
    });

    test('empty string content rejected by validation', () => {
      // Schema requires non-empty content for markdown blocks
      const guide: JsonGuide = {
        ...baseGuide,
        blocks: [{ type: 'markdown', content: '' }],
      };
      const { result } = roundTrip(guide);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test('whitespace-only content is valid', () => {
      const guide: JsonGuide = {
        ...baseGuide,
        blocks: [{ type: 'markdown', content: '   ' }],
      };
      const { result } = roundTrip(guide);
      expect(result.isValid).toBe(true);
      const block = result.guide?.blocks[0] as JsonMarkdownBlock;
      expect(block.content).toBe('   ');
    });

    test('large content preserved', () => {
      const largeContent = 'x'.repeat(10000);
      const guide: JsonGuide = {
        ...baseGuide,
        blocks: [{ type: 'markdown', content: largeContent }],
      };
      const { result } = roundTrip(guide);
      expect(result.isValid).toBe(true);
      const block = result.guide?.blocks[0] as JsonMarkdownBlock;
      expect(block.content).toBe(largeContent);
      expect(block.content.length).toBe(10000);
    });

    test('schema version preserved', () => {
      const guide: JsonGuide = {
        ...baseGuide,
        schemaVersion: '1.0.0',
      };
      const { result } = roundTrip(guide);
      expect(result.isValid).toBe(true);
      expect(result.guide?.schemaVersion).toBe('1.0.0');
    });

    test('empty arrays preserved', () => {
      const guide: JsonGuide = {
        ...baseGuide,
        blocks: [
          {
            type: 'section',
            title: 'Empty Section',
            blocks: [],
            requirements: [],
            objectives: [],
          },
        ],
      };
      const { result } = roundTrip(guide);
      expect(result.isValid).toBe(true);
      const section = result.guide?.blocks[0] as JsonSectionBlock;
      expect(section.blocks).toEqual([]);
      expect(section.requirements).toEqual([]);
      expect(section.objectives).toEqual([]);
    });

    test('complex nested structure preserved', () => {
      const guide: JsonGuide = {
        ...baseGuide,
        blocks: [
          {
            type: 'section',
            title: 'Main Section',
            blocks: [
              { type: 'markdown', content: 'Intro' },
              {
                type: 'conditional',
                conditions: ['has-datasource:prometheus'],
                whenTrue: [
                  {
                    type: 'multistep',
                    content: 'Prometheus steps',
                    steps: [{ action: 'button', reftarget: '.btn' }],
                  },
                ],
                whenFalse: [{ type: 'markdown', content: 'Add Prometheus first' }],
              },
              { type: 'quiz', question: 'Did you complete the steps?', choices: [{ id: 'yes', text: 'Yes', correct: true }] },
            ],
          },
        ],
      };
      const { result } = roundTrip(guide);
      expect(result.isValid).toBe(true);
      const section = result.guide?.blocks[0] as JsonSectionBlock;
      expect(section.blocks).toHaveLength(3);
      const conditional = section.blocks[1] as JsonConditionalBlock;
      expect(conditional.whenTrue).toHaveLength(1);
      const multistep = conditional.whenTrue[0] as JsonMultistepBlock;
      expect(multistep.steps).toHaveLength(1);
    });
  });

  // ============ ASSISTANT PROPS ============

  describe('assistant props', () => {
    test('markdown with assistant props preserved', () => {
      const guide: JsonGuide = {
        ...baseGuide,
        blocks: [
          {
            type: 'markdown',
            content: '```sql\nSELECT * FROM users\n```',
            assistantEnabled: true,
            assistantId: 'custom-query-1',
            assistantType: 'query',
          },
        ],
      };
      const { result } = roundTrip(guide);
      expect(result.isValid).toBe(true);
      const block = result.guide?.blocks[0] as JsonMarkdownBlock;
      expect(block.assistantEnabled).toBe(true);
      expect(block.assistantId).toBe('custom-query-1');
      expect(block.assistantType).toBe('query');
    });

    test('interactive with assistant props preserved', () => {
      const guide: JsonGuide = {
        ...baseGuide,
        blocks: [
          {
            type: 'interactive',
            action: 'formfill',
            reftarget: 'textarea',
            content: 'Enter query',
            assistantEnabled: true,
            assistantType: 'code',
          },
        ],
      };
      const { result } = roundTrip(guide);
      expect(result.isValid).toBe(true);
      const block = result.guide?.blocks[0] as JsonInteractiveBlock;
      expect(block.assistantEnabled).toBe(true);
      expect(block.assistantType).toBe('code');
    });
  });
});
