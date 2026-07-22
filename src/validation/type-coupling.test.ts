import type { JsonGuide, JsonBlock } from '../types/json-guide.types';
import {
  JsonGuideSchema,
  JsonMarkdownBlockSchema,
  JsonHtmlBlockSchema,
  JsonImageBlockSchema,
  JsonVideoBlockSchema,
  JsonInteractiveBlockSchema,
  JsonMultistepBlockSchema,
  JsonGuidedBlockSchema,
  JsonSectionBlockSchema,
  JsonCollapsibleBlockSchema,
  PresentationalBlockSchema,
  JsonQuizBlockSchema,
  JsonAssistantBlockSchema,
  JsonInputBlockSchema,
  JsonGrotGuideBlockSchema,
  KNOWN_FIELDS,
  type InferredJsonGuide,
} from '../types/json-guide.schema';
import { z } from 'zod';

describe('Type Coupling: TypeScript <-> Zod', () => {
  it('JsonGuide types should be assignable', () => {
    // This tests that TypeScript types and Zod inferred types are compatible.
    // Due to recursive schema limitations, the inferred blocks type is unknown[].
    // We verify compatibility by explicitly typing the blocks array.
    const zodGuide: InferredJsonGuide = {
      id: 'test',
      title: 'Test',
      blocks: [] as JsonBlock[],
      schemaVersion: '1.0.0',
    };
    // Cast is needed because InferredJsonGuide.blocks is unknown[] due to recursive z.lazy()
    const fromZod: JsonGuide = zodGuide as JsonGuide;

    const tsGuide: JsonGuide = {
      id: 'test',
      title: 'Test',
      blocks: [],
      schemaVersion: '1.0.0',
    };
    const fromTs: InferredJsonGuide = {
      ...tsGuide,
      schemaVersion: '1.0.0' as const,
    };

    expect(fromZod).toBeDefined();
    expect(fromTs).toBeDefined();
  });

  it('should parse valid TypeScript-typed guide', () => {
    const tsGuide: JsonGuide = {
      id: 'test',
      title: 'Test',
      blocks: [{ type: 'markdown', content: 'Hello' }],
    };
    const result = JsonGuideSchema.safeParse(tsGuide);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(tsGuide);
    }
  });

  it('should round-trip guide through JSON', () => {
    const original: JsonGuide = {
      id: 'test-guide',
      title: 'Test Guide',
      blocks: [
        { type: 'markdown', content: 'Content' },
        {
          type: 'interactive',
          action: 'button',
          reftarget: '.btn',
          content: 'Click me',
        },
      ],
    };

    const jsonString = JSON.stringify(original);
    const parsedJson = JSON.parse(jsonString);
    const result = JsonGuideSchema.parse(parsedJson);

    expect(result).toEqual(original);
  });
});

describe('KNOWN_FIELDS sync', () => {
  // Helper to verify schema keys match KNOWN_FIELDS
  // Uses z.ZodObject<z.ZodRawShape> for Zod v4 compatibility
  const verifyFields = (schema: z.ZodObject<z.ZodRawShape>, typeName: string) => {
    const schemaKeys = Object.keys(schema.shape);
    const knownKeys = Array.from(KNOWN_FIELDS[typeName] || []);
    expect(schemaKeys.sort()).toEqual(knownKeys.sort());
  };

  // Helper for schemas with .refine() - access the inner schema via Zod 4 API

  const verifyFieldsFromEffects = (schema: z.ZodType<any>, typeName: string) => {
    // Zod 4: effects schemas expose innerType via _zod.def

    const innerSchema = (schema as any)._zod?.def?.innerType;
    if (innerSchema && 'shape' in innerSchema) {
      const schemaKeys = Object.keys(innerSchema.shape);
      const knownKeys = Array.from(KNOWN_FIELDS[typeName] || []);
      expect(schemaKeys.sort()).toEqual(knownKeys.sort());
    }
  };

  it('should match markdown schema fields', () => {
    verifyFields(JsonMarkdownBlockSchema, 'markdown');
  });

  it('should match html schema fields', () => {
    verifyFields(JsonHtmlBlockSchema, 'html');
  });

  it('should match image schema fields', () => {
    verifyFields(JsonImageBlockSchema, 'image');
  });

  it('should match video schema fields', () => {
    verifyFields(JsonVideoBlockSchema, 'video');
  });

  it('should match interactive schema fields', () => {
    verifyFieldsFromEffects(JsonInteractiveBlockSchema, 'interactive');
  });

  it('should match multistep schema fields', () => {
    verifyFields(JsonMultistepBlockSchema, 'multistep');
  });

  it('should match guided schema fields', () => {
    verifyFields(JsonGuidedBlockSchema, 'guided');
  });

  it('should match section schema fields', () => {
    verifyFields(JsonSectionBlockSchema, 'section');
  });

  it('should match collapsible schema fields', () => {
    verifyFields(JsonCollapsibleBlockSchema, 'collapsible');
  });

  // Drift guard: PresentationalBlockSchema (collapsible children) and the
  // PresentationalBlock type must list the same block types. If the union
  // gains/loses a member on one side only, one of these assertions fails.
  describe('PresentationalBlockSchema membership', () => {
    it('accepts the content block types', () => {
      const accepted: unknown[] = [
        { type: 'markdown', content: 'x' },
        { type: 'html', content: '<p>x</p>' },
        { type: 'image', src: 'https://example.com/x.png' },
        { type: 'video', src: 'https://example.com/x.mp4', provider: 'native' },
      ];
      for (const block of accepted) {
        expect(PresentationalBlockSchema.safeParse(block).success).toBe(true);
      }
    });

    it('rejects interactive, step, and container types', () => {
      const rejected: unknown[] = [
        { type: 'interactive', action: 'highlight', reftarget: 'x', content: 'y' },
        { type: 'code-block', reftarget: 'x', code: 'y' },
        { type: 'quiz', question: 'q', choices: [{ id: 'a', text: 'a', correct: true }] },
        { type: 'section', blocks: [] },
        { type: 'collapsible', blocks: [] },
        { type: 'conditional', conditions: ['is-admin'], whenTrue: [], whenFalse: [] },
      ];
      for (const block of rejected) {
        expect(PresentationalBlockSchema.safeParse(block).success).toBe(false);
      }
    });
  });

  it('should match quiz schema fields', () => {
    verifyFields(JsonQuizBlockSchema, 'quiz');
  });

  it('should match assistant schema fields', () => {
    verifyFields(JsonAssistantBlockSchema, 'assistant');
  });

  it('should match input schema fields', () => {
    verifyFields(JsonInputBlockSchema, 'input');
  });

  it('should match grot-guide schema fields', () => {
    verifyFieldsFromEffects(JsonGrotGuideBlockSchema, 'grot-guide');
  });
});
