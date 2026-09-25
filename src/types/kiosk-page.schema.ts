import { z } from 'zod';

const text = z.string().min(1).max(4096);
const name = z
  .string()
  .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/)
  .max(100)
  .refine((value) => !['__proto__', 'prototype', 'constructor'].includes(value), 'Reserved name');
const alignment = z.enum(['start', 'center']).optional();

export const KioskInputSchema = z
  .strictObject({
    inputType: z.enum(['text', 'datasource']),
    format: z.enum(['http-origin']).optional(),
    variableName: name,
    prompt: text,
    placeholder: text.optional(),
    required: z.boolean().optional(),
    datasourceFilter: text.optional(),
  })
  .superRefine((input, ctx) => {
    if ((input.inputType === 'datasource' && input.format) || (input.inputType === 'text' && input.datasourceFilter)) {
      ctx.addIssue({ code: 'custom', message: 'Input options do not match inputType' });
    }
  });

export const KioskPageSchema = z
  .strictObject({
    version: z.literal(1),
    width: z.enum(['standard', 'wide']).optional(),
    spacing: z.enum(['normal', 'spacious']).optional(),
    header: z.enum(['standard', 'minimal']).optional(),
    blocks: z
      .array(
        z.discriminatedUnion('type', [
          z.strictObject({
            type: z.literal('hero'),
            eyebrow: text.optional(),
            title: text,
            description: text.optional(),
            alignment,
          }),
          z.strictObject({ type: z.literal('text'), content: text, alignment, secondary: z.boolean().optional() }),
          z.strictObject({
            type: z.literal('launch-form'),
            ruleId: name,
            label: text,
            inputs: z.array(KioskInputSchema).min(1).max(10),
          }),
          z.strictObject({ type: z.literal('command'), command: text, language: z.enum(['bash', 'text']).optional() }),
          z.strictObject({ type: z.literal('divider'), label: text.optional() }),
          z.strictObject({
            type: z.literal('guide-links'),
            layout: z.enum(['cards', 'links']),
            links: z
              .array(z.strictObject({ ruleId: name, label: text.optional(), description: text.optional() }))
              .min(1)
              .max(30),
          }),
        ])
      )
      .min(1)
      .max(50),
  })
  .superRefine((page, ctx) => {
    for (const block of page.blocks) {
      if (
        block.type === 'launch-form' &&
        new Set(block.inputs.map((input) => input.variableName)).size !== block.inputs.length
      ) {
        ctx.addIssue({ code: 'custom', message: 'Duplicate input variable name' });
      }
    }
  });

export type KioskPage = z.infer<typeof KioskPageSchema>;
export type KioskInput = z.infer<typeof KioskInputSchema>;
export type KioskPageBlock = KioskPage['blocks'][number];

export const KioskCatalogSchema = z
  .strictObject({
    banner: z.string().optional(),
    page: KioskPageSchema,
    rules: z
      .array(
        z.strictObject({
          id: name,
          title: text,
          url: text,
          description: z.string().max(4096),
          type: z.string().optional(),
          targetUrl: text.optional(),
          page: text.optional(),
        })
      )
      .min(1)
      .max(100),
  })
  .superRefine((catalog, ctx) => {
    const ids = new Set(catalog.rules.map((rule) => rule.id));
    if (ids.size !== catalog.rules.length) {
      ctx.addIssue({ code: 'custom', message: 'Duplicate rule ID' });
    }
    for (const block of catalog.page.blocks) {
      const refs =
        block.type === 'launch-form'
          ? [block.ruleId]
          : block.type === 'guide-links'
            ? block.links.map((link) => link.ruleId)
            : [];
      if (refs.some((id) => !ids.has(id))) {
        ctx.addIssue({ code: 'custom', message: 'Unknown rule reference' });
      }
    }
  });

export type KioskMode = 'instance' | 'presentation';
