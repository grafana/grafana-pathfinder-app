import { materializeStepIdsInJson } from './ai-fix-step-id';

describe('materializeStepIdsInJson', () => {
  it('writes a canonical id onto an anonymous addressable block', () => {
    const out = materializeStepIdsInJson(
      JSON.stringify({ blocks: [{ type: 'interactive', action: 'button', reftarget: '.x' }] })
    );
    const block = JSON.parse(out).blocks[0];
    expect(typeof block.id).toBe('string');
    expect(block.id.length).toBeGreaterThan(0);
  });

  it('preserves an author-provided id', () => {
    const out = materializeStepIdsInJson(
      JSON.stringify({ blocks: [{ id: 'author-step', type: 'interactive', action: 'button', reftarget: '.x' }] })
    );
    expect(JSON.parse(out).blocks[0].id).toBe('author-step');
  });

  it('returns the input unchanged when it is not valid JSON', () => {
    expect(materializeStepIdsInJson('not json {')).toBe('not json {');
  });

  it('returns the input unchanged when it is not a guide-shaped object', () => {
    expect(materializeStepIdsInJson('{"nope":true}')).toBe('{"nope":true}');
    expect(materializeStepIdsInJson('[]')).toBe('[]');
  });
});
