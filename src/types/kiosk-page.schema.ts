import { z } from 'zod';

const text = z.string().min(1).max(4096);
export const KioskExitButtonLabelSchema = z.string().trim().min(1).max(200);
const name = z
  .string()
  .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/)
  .max(100)
  .refine((value) => !['__proto__', 'prototype', 'constructor'].includes(value), 'Reserved name');
const alignment = z.enum(['start', 'center']).optional();

export const KioskInputSchema = z
  .strictObject({
    inputType: z.enum(['text', 'datasource']),
    format: z.enum(['http-origin', 'http-url']).optional(),
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

export const KioskPageV1Schema = z
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
            variant: z.enum(['standard', 'banner']).optional(),
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

export const KioskImageSchema = z
  .strictObject({
    src: z
      .string()
      .min(1)
      .max(2048)
      .refine((value) => {
        if (/[\\\x00-\x20]/.test(value) || value.startsWith('//')) {
          return false;
        }
        try {
          const url = new URL(value, 'https://kiosk.invalid/');
          return url.protocol === 'https:' && !url.username && !url.password;
        } catch {
          return false;
        }
      }, 'Use an HTTPS image URL or a relative image path'),
    alt: z.string().max(500).optional(),
    decorative: z.boolean().optional(),
    caption: text.optional(),
    aspectRatio: z.enum(['auto', 'square', 'wide', 'portrait']).optional(),
    fit: z.enum(['contain', 'cover']).optional(),
  })
  .superRefine((image, ctx) => {
    if (!image.decorative && !image.alt?.trim()) {
      ctx.addIssue({ code: 'custom', path: ['alt'], message: 'Images need alternative text or decorative: true' });
    }
  });

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a six-digit hex color');
const background = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('solid'), color: hexColor }),
  z.strictObject({
    type: z.literal('gradient'),
    from: hexColor,
    to: hexColor,
    direction: z.enum(['right', 'down', 'diagonal']).optional(),
  }),
]);

function luminance(hex: string): number {
  const channels = [1, 3, 5]
    .map((start) => parseInt(hex.slice(start, start + 2), 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

export function kioskForeground(colors: string[]): '#000000' | '#ffffff' | undefined {
  const values = colors.map(luminance);
  if (values.every((value) => (value + 0.05) / 0.05 >= 4.5)) {
    return '#000000';
  }
  if (values.every((value) => 1.05 / (value + 0.05) >= 4.5)) {
    return '#ffffff';
  }
  return undefined;
}

export function kioskBackgroundColors(value: z.infer<typeof background>): string[] {
  if (value.type === 'solid') {
    return [value.color];
  }
  // Channel minima bound the darkest point between gradient stops.
  const darkest =
    '#' +
    [1, 3, 5]
      .map((offset) =>
        Math.min(parseInt(value.from.slice(offset, offset + 2), 16), parseInt(value.to.slice(offset, offset + 2), 16))
          .toString(16)
          .padStart(2, '0')
      )
      .join('');
  return [value.from, value.to, darkest];
}

export const KioskAppearanceSchema = z
  .strictObject({
    preset: z.enum(['grafana', 'subtle', 'bold']).optional(),
    accentColor: hexColor.optional(),
    background: background.optional(),
    density: z.enum(['compact', 'normal', 'spacious']).optional(),
    radius: z.enum(['none', 'small', 'large']).optional(),
  })
  .superRefine((appearance, ctx) => {
    if (appearance.background && !kioskForeground(kioskBackgroundColors(appearance.background))) {
      ctx.addIssue({
        code: 'custom',
        path: ['background'],
        message: 'Choose background colors that share a readable black or white foreground (4.5:1 contrast)',
      });
    }
  });

const action = z.strictObject({ ruleId: name, label: text });
const legacyBlocks = KioskPageV1Schema.shape.blocks.element.options;
export const KioskLeafV2Schema = z.discriminatedUnion('type', [
  legacyBlocks[0].extend({
    image: KioskImageSchema.optional(),
    layout: z.enum(['stacked', 'split']).optional(),
    titleSize: z.enum(['medium', 'large', 'extra-large']).optional(),
    primaryAction: action.optional(),
    secondaryAction: action.optional(),
    appearance: KioskAppearanceSchema.optional(),
  }),
  legacyBlocks[1].extend({ format: z.enum(['plain', 'markdown']).optional() }),
  legacyBlocks[2],
  legacyBlocks[3],
  legacyBlocks[4],
  legacyBlocks[5].extend({
    columns: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    links: z
      .array(
        legacyBlocks[5].shape.links.element.extend({
          image: KioskImageSchema.optional(),
          icon: z.enum(['compass', 'book-open', 'rocket', 'chart-line', 'heart', 'bolt', 'cloud']).optional(),
          badge: text.optional(),
          actionLabel: text.optional(),
          featured: z.boolean().optional(),
        })
      )
      .min(1)
      .max(30),
  }),
  z.strictObject({ type: z.literal('image'), image: KioskImageSchema }),
]);
const columnsBlock = z
  .strictObject({
    type: z.literal('columns'),
    ratio: z.enum(['equal', 'wide-left', 'wide-right']).optional(),
    columns: z
      .array(
        z.strictObject({
          title: text.optional(),
          eyebrow: text.optional(),
          description: text.optional(),
          appearance: KioskAppearanceSchema.optional(),
          blocks: z.array(KioskLeafV2Schema).min(1).max(50),
        })
      )
      .min(2)
      .max(3),
  })
  .superRefine((block, ctx) => {
    if (block.columns.length === 3 && block.ratio && block.ratio !== 'equal') {
      ctx.addIssue({ code: 'custom', path: ['ratio'], message: 'Unequal columns require exactly two columns' });
    }
  });
const sectionBlock = z.strictObject({
  type: z.literal('section'),
  title: text.optional(),
  description: text.optional(),
  appearance: KioskAppearanceSchema.optional(),
  blocks: z
    .array(z.discriminatedUnion('type', [...KioskLeafV2Schema.options, columnsBlock]))
    .min(1)
    .max(50),
});
export const KioskPageV2Schema = z.strictObject({
  version: z.literal(2),
  brand: z
    .strictObject({ name: text.optional(), logo: KioskImageSchema.optional() })
    .refine(
      (brand) => Boolean(brand.name || (brand.logo?.alt?.trim() && !brand.logo.decorative)),
      'Provide a brand name or a logo with alternative text'
    )
    .optional(),
  width: z.enum(['standard', 'wide']).optional(),
  spacing: z.enum(['normal', 'spacious']).optional(),
  header: z.enum(['standard', 'minimal']).optional(),
  appearance: KioskAppearanceSchema.optional(),
  blocks: z
    .array(z.discriminatedUnion('type', [...KioskLeafV2Schema.options, columnsBlock, sectionBlock]))
    .min(1)
    .max(50),
});
export const KioskPageSchema = z.discriminatedUnion('version', [KioskPageV1Schema, KioskPageV2Schema]);
export type KioskPage = z.infer<typeof KioskPageSchema>;
export type KioskPageV1 = z.infer<typeof KioskPageV1Schema>;
export type KioskPageV2 = z.infer<typeof KioskPageV2Schema>;
export type KioskAppearance = z.infer<typeof KioskAppearanceSchema>;
export type KioskImage = z.infer<typeof KioskImageSchema>;
export type KioskLeafV2 = z.infer<typeof KioskLeafV2Schema>;
export type KioskInput = z.infer<typeof KioskInputSchema>;
export type KioskPageBlock = KioskPageV1['blocks'][number];

export function flattenKioskBlocks(blocks: KioskPage['blocks']): Array<KioskPage['blocks'][number]> {
  return blocks.flatMap((block) => [
    block,
    ...(block.type === 'section'
      ? flattenKioskBlocks(block.blocks)
      : block.type === 'columns'
        ? block.columns.flatMap((column) => flattenKioskBlocks(column.blocks))
        : []),
  ]);
}

export const KioskCatalogSchema = z
  .strictObject({
    banner: z.string().optional(),
    exitButtonLabel: KioskExitButtonLabelSchema.optional(),
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
          interactiveLearning: z.boolean().optional(),
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
    for (const rule of catalog.rules) {
      if (
        rule.interactiveLearning === false &&
        (!rule.page || !rule.page.startsWith('/') || rule.page.startsWith('//') || /[\\\x00-\x20]/.test(rule.page))
      ) {
        ctx.addIssue({ code: 'custom', message: 'Product rules require an internal page path' });
      }
    }
    const blocks = flattenKioskBlocks(catalog.page.blocks);
    if (blocks.length > 50) {
      ctx.addIssue({
        code: 'custom',
        path: ['page', 'blocks'],
        message: 'A kiosk may contain at most 50 blocks including containers',
      });
    }
    for (const block of blocks) {
      if (
        block.type === 'launch-form' &&
        new Set(block.inputs.map((input) => input.variableName)).size !== block.inputs.length
      ) {
        ctx.addIssue({ code: 'custom', message: 'Duplicate input variable name' });
      }
      if (
        block.type === 'launch-form' &&
        catalog.rules.find((rule) => rule.id === block.ruleId)?.interactiveLearning === false
      ) {
        ctx.addIssue({ code: 'custom', message: 'Launch forms require interactive learning' });
      }
      const refs =
        block.type === 'launch-form'
          ? [block.ruleId]
          : block.type === 'hero' && ('primaryAction' in block || 'secondaryAction' in block)
            ? [block.primaryAction?.ruleId, block.secondaryAction?.ruleId].filter((id): id is string => Boolean(id))
            : block.type === 'guide-links'
              ? block.links.map((link) => link.ruleId)
              : [];
      if (refs.some((id) => !ids.has(id))) {
        ctx.addIssue({ code: 'custom', message: 'Unknown rule reference' });
      }
    }
  });

export type KioskMode = 'instance' | 'presentation';

const legacyRule = KioskCatalogSchema.shape.rules.element.extend({ id: name.optional() });
export const LegacyKioskCatalogSchema = z.strictObject({
  banner: z.string().optional(),
  exitButtonLabel: KioskExitButtonLabelSchema.optional(),
  rules: z.array(legacyRule).min(1).max(100),
});
export const KioskCatalogDocumentSchema = z.union([
  KioskCatalogSchema,
  LegacyKioskCatalogSchema,
  z.array(legacyRule).min(1).max(100),
]);

export function safeParseKioskCatalog(value: unknown) {
  if (Array.isArray(value)) {
    return z.array(legacyRule).min(1).max(100).safeParse(value);
  }
  return value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'page')
    ? KioskCatalogSchema.safeParse(value)
    : LegacyKioskCatalogSchema.safeParse(value);
}
