import { KioskCatalogSchema } from './kiosk-page.schema';
import demo from '../../docs/examples/kiosk/dem.json';

it('accepts the complete DEM example', () => expect(KioskCatalogSchema.safeParse(demo).success).toBe(true));
it.each([
  { version: 2 },
  { style: 'color:red' },
  {
    blocks: [
      {
        type: 'launch-form',
        ruleId: 'missing',
        label: 'Start',
        inputs: [{ inputType: 'text', variableName: 'appUrl', prompt: 'URL' }],
      },
    ],
  },
  { blocks: [{ type: 'html', content: '<script>evil()</script>' }] },
  {
    blocks: [
      {
        type: 'launch-form',
        ruleId: 'combined',
        label: 'Start',
        inputs: [{ inputType: 'text', variableName: 'constructor', prompt: 'URL' }],
      },
    ],
  },
])('rejects malformed pages %j', (patch) => {
  expect(KioskCatalogSchema.safeParse({ ...demo, page: { ...demo.page, ...patch } }).success).toBe(false);
});
it('rejects duplicate rule IDs and input names', () => {
  expect(KioskCatalogSchema.safeParse({ ...demo, rules: [demo.rules[0], demo.rules[0]] }).success).toBe(false);
  const input = { inputType: 'text', variableName: 'appUrl', prompt: 'URL' };
  expect(
    KioskCatalogSchema.safeParse({
      ...demo,
      page: {
        version: 1,
        blocks: [{ type: 'launch-form', ruleId: 'combined', label: 'Start', inputs: [input, input] }],
      },
    }).success
  ).toBe(false);
});
it('accepts remaining presentation blocks without arbitrary styling', () => {
  expect(
    KioskCatalogSchema.safeParse({
      ...demo,
      page: {
        version: 1,
        blocks: [
          { type: 'command', command: 'echo demo' },
          { type: 'guide-links', layout: 'cards', links: [{ ruleId: 'combined', description: 'Set up monitoring' }] },
        ],
      },
    }).success
  ).toBe(true);
});

it.each(['bash', 'text'])('accepts command language %s', (language) => {
  expect(
    KioskCatalogSchema.safeParse({
      ...demo,
      page: { version: 1, blocks: [{ type: 'command', command: 'echo demo', language }] },
    }).success
  ).toBe(true);
});
it('rejects unsupported command languages', () => {
  expect(
    KioskCatalogSchema.safeParse({
      ...demo,
      page: { version: 1, blocks: [{ type: 'command', command: 'echo demo', language: 'html' }] },
    }).success
  ).toBe(false);
});
