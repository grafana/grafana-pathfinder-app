/**
 * Tripwire for silently dropped authoring fields.
 *
 * `content-renderer.tsx` forwards parser output to `<InteractiveStep>` through
 * an explicit prop list. Adding a field to the JSON schema, the types and the
 * parser is not enough — if it is missing from that list the field vanishes
 * with no error, no warning and passing unit tests. `targetstate` shipped
 * broken exactly this way and was only caught by loading a guide in a browser.
 *
 * This test compares what the parser emits against what the renderer forwards,
 * so the next dropped field fails here instead of in production.
 */

import * as fs from 'fs';
import * as path from 'path';

import { parseJsonGuide } from '../../docs-retrieval/json-parser';
import type { JsonGuide } from '../../types/json-guide.types';

/**
 * Fields the parser emits that the renderer does not forward. These are
 * pre-existing gaps, not intentional design — an author who sets them on a
 * JSON guide gets silence. Documented here rather than fixed so this tripwire
 * can land without changing runtime behaviour; shrinking this list is the fix.
 */
const KNOWN_UNFORWARDED: string[] = [];

/** Exercises every author-settable field on an interactive block. */
const GUIDE = {
  id: 'prop-forwarding',
  title: 'Prop forwarding',
  blocks: [
    {
      type: 'interactive',
      action: 'highlight',
      reftarget: 'button.target',
      targetvalue: 'value',
      targetstate: true,
      content: 'Content',
      tooltip: 'Tooltip',
      requirements: ['exists-reftarget'],
      objectives: ['is-admin'],
      skippable: true,
      hint: 'Hint',
      formHint: 'Form hint',
      validateInput: true,
      showMe: true,
      doIt: true,
      completeEarly: true,
      verify: 'is-admin',
      lazyRender: true,
      scrollContainer: '.scroll',
      openGuide: 'bundled:other',
    },
  ],
} as unknown as JsonGuide;

function forwardedProps(): Set<string> {
  const source = fs.readFileSync(path.resolve(__dirname, 'content-renderer.tsx'), 'utf8');
  const start = source.indexOf("case 'interactive-step':");
  expect(start).toBeGreaterThan(-1);
  const block = source.slice(start, source.indexOf('</InteractiveStep>', start));
  return new Set(Array.from(block.matchAll(/element\.props\.(\w+)/g)).map((match) => match[1]!));
}

function emittedProps(): string[] {
  const parsed = parseJsonGuide(GUIDE);
  const step = parsed.data!.elements.find((element) => element.type === 'interactive-step');
  expect(step).toBeDefined();
  return Object.keys(step!.props)
    .filter((key) => step!.props[key] !== undefined)
    .sort();
}

describe('content-renderer prop forwarding', () => {
  it('forwards every field the parser emits, except the documented gaps', () => {
    const forwarded = forwardedProps();
    const dropped = emittedProps().filter((key) => !forwarded.has(key));

    expect(dropped.sort()).toEqual([...KNOWN_UNFORWARDED].sort());
  });

  it('forwards targetState, so toggle steps do not blind-click', () => {
    expect(forwardedProps()).toContain('targetState');
    expect(emittedProps()).toContain('targetState');
  });

  it('keeps the documented-gap list honest — every entry is still emitted by the parser', () => {
    const emitted = emittedProps();
    KNOWN_UNFORWARDED.forEach((key) => {
      expect(emitted).toContain(key);
    });
  });
});
