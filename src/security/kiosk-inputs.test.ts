import { validateKioskValues } from './kiosk-inputs';
import { validateKioskDestination } from '../docs-retrieval/kiosk-inputs';
import { normalizeHttpOrigin } from '../lib/input-value';
import type { JsonGuide } from '../types/json-guide.types';
import type { KioskInput } from '../types/kiosk-page.schema';

const input: KioskInput = {
  inputType: 'text',
  variableName: 'appUrl',
  prompt: 'Website',
  format: 'http-origin',
  required: true,
};
const guide = (blocks: unknown[]): JsonGuide => ({ id: 'demo', title: 'Demo', blocks }) as JsonGuide;
const declaration = { type: 'input', ...input };

it.each(['https://example.com', 'http://localhost:3000', 'https://example.com/'])(
  'accepts and normalizes %s',
  (value) => {
    expect(normalizeHttpOrigin(value)).toBe(new URL(value).origin);
  }
);
it.each([
  'javascript:alert(1)',
  'data:text/plain,x',
  'https://a:b@example.com',
  'https://@example.com',
  'https://example.com\\foo',
  'https://' + 'a'.repeat(2048),
])('rejects unsafe input %s', (value) => expect(normalizeHttpOrigin(value)).toBeNull());
it('normalizes only submitted keys and rejects missing, reserved and oversized inputs', () => {
  expect(validateKioskValues([input], { appUrl: 'https://example.com/', ignored: 'secret' })).toEqual({
    appUrl: 'https://example.com',
  });
  expect(() => validateKioskValues([input], {})).toThrow('required');
  expect(() => validateKioskValues([{ ...input, variableName: '__proto__' }], {})).toThrow();
  expect(() => validateKioskValues([{ ...input, format: undefined }], { appUrl: 'a'.repeat(2049) })).toThrow();
});
it('accepts display text and formfill in nested steps', () => {
  expect(() =>
    validateKioskDestination(
      guide([
        declaration,
        {
          type: 'section',
          blocks: [
            { type: 'markdown', content: 'Monitor **{{appUrl}}**' },
            { type: 'interactive', action: 'formfill', targetvalue: '{{appUrl}}', reftarget: '#url' },
          ],
        },
      ]),
      [input]
    )
  ).not.toThrow();
});
it.each([
  { type: 'terminal', command: 'curl {{appUrl}}' },
  { type: 'interactive', action: 'navigate', reftarget: '{{appUrl}}' },
  { type: 'interactive', action: 'formfill', reftarget: '#{{appUrl}}' },
  { type: 'html', content: '<p>{{appUrl}}</p>' },
  { type: 'markdown', content: '[Open]({{appUrl}})' },
  { type: 'markdown', content: '<a href="{{appUrl}}">Open</a>' },
  { type: 'code-block', code: '{{appUrl}}' },
  { type: 'snippet-ref', snippetId: 'unresolved' },
])('rejects unsafe use inside nested content: %j', (block) => {
  expect(() =>
    validateKioskDestination(guide([declaration, { type: 'conditional', whenTrue: [block] }]), [input])
  ).toThrow();
});
it.each([
  [],
  [declaration, declaration],
  [{ ...declaration, inputType: 'datasource' }],
  [{ ...declaration, format: undefined }],
  [{ ...declaration, pattern: '.*' }],
])('rejects missing, ambiguous and unsupported declarations: %j', (...blocks) => {
  expect(() => validateKioskDestination(guide(blocks), [input])).toThrow();
});

it('accepts supported nested form-fill aliases while rejecting aliased executable sinks', () => {
  expect(() =>
    validateKioskDestination(
      guide([
        declaration,
        {
          type: 'section',
          blocks: [{ type: 'interactive', targetAction: 'formfill', targetValue: '{{appUrl}}', refTarget: '#url' }],
        },
      ]),
      [input]
    )
  ).not.toThrow();
  expect(() =>
    validateKioskDestination(
      guide([declaration, { type: 'interactive', targetAction: 'navigate', targetValue: '{{appUrl}}' }]),
      [input]
    )
  ).toThrow();
  expect(() =>
    validateKioskDestination(
      guide([
        declaration,
        { type: 'interactive', action: 'navigate', targetAction: 'formfill', targetValue: '{{appUrl}}' },
      ]),
      [input]
    )
  ).toThrow();
});

it('preserves the HTTP check target while deriving an exact frontend origin', () => {
  const fullUrlInput = { ...input, format: 'http-url' as const };
  expect(validateKioskValues([fullUrlInput], { appUrl: ' example.com:8443/shop?q=boots#details ' })).toEqual({
    appUrl: 'https://example.com:8443/shop?q=boots',
  });
  expect(validateKioskValues([input], { appUrl: ' example.com:8443/shop?q=boots#details ' })).toEqual({
    appUrl: 'https://example.com:8443',
  });
});
it('validates origin substitutions against the same sink restrictions', () => {
  const fullUrlInput = { ...input, format: 'http-url' as const };
  const declaration = { type: 'input', ...fullUrlInput };
  expect(() =>
    validateKioskDestination(
      guide([
        declaration,
        { type: 'markdown', content: 'Allowed origin: {{appUrl:origin}}' },
        { type: 'interactive', action: 'formfill', targetvalue: '{{appUrl:origin}}', reftarget: '#origin' },
      ]),
      [fullUrlInput]
    )
  ).not.toThrow();
  for (const block of [
    { type: 'terminal', command: 'curl {{appUrl:origin}}' },
    { type: 'markdown', content: '[Open]({{appUrl:origin}})' },
    { type: 'interactive', action: 'navigate', reftarget: '{{appUrl:origin}}' },
    { type: 'interactive', action: 'formfill', reftarget: '#{{appUrl:origin}}' },
  ]) {
    expect(() => validateKioskDestination(guide([declaration, block]), [fullUrlInput])).toThrow();
  }
});
