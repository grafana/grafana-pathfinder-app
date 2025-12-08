
import type { JsonGuide, JsonBlock, JsonStep } from '../../types/json-guide.types';
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
  JsonQuizBlockSchema,
  JsonAssistantBlockSchema,
  KNOWN_FIELDS 
} from '../../types/json-guide.schema';
import type { InferredJsonGuide, InferredJsonBlock, InferredJsonStep } from '../../types/json-guide.schema';
import { z } from 'zod';

describe('Type Coupling: TypeScript <-> Zod', () => {
  it('JsonGuide types should be assignable', () => {
    // This tests that TypeScript types and Zod inferred types are compatible.
    // Ideally this would be a compile-time check, but runtime assignment works too for basic compatibility.
    // If types are incompatible, TS would complain here during build/check.
    const fromZod: JsonGuide = {} as InferredJsonGuide;
    const fromTs: InferredJsonGuide = {} as JsonGuide;
    
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
          content: 'Click me' 
        }
      ]
    };
    
    const jsonString = JSON.stringify(original);
    const parsedJson = JSON.parse(jsonString);
    const result = JsonGuideSchema.parse(parsedJson);
    
    expect(result).toEqual(original);
  });
});

describe('KNOWN_FIELDS sync', () => {
  // Helper to verify schema keys match KNOWN_FIELDS
  const verifyFields = (schema: z.AnyZodObject, typeName: string) => {
    const schemaKeys = Object.keys(schema.shape);
    const knownKeys = Array.from(KNOWN_FIELDS[typeName] || []);
    expect(schemaKeys.sort()).toEqual(knownKeys.sort());
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
    verifyFields(JsonInteractiveBlockSchema, 'interactive');
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

  it('should match quiz schema fields', () => {
    verifyFields(JsonQuizBlockSchema, 'quiz');
  });

  it('should match assistant schema fields', () => {
    verifyFields(JsonAssistantBlockSchema, 'assistant');
  });
});

