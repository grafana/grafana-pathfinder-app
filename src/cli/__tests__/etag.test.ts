import { ARTIFACT_ETAG_FIELD, computeArtifactEtag, splitArtifactEtag } from '../utils/etag';

describe('computeArtifactEtag', () => {
  const baseContent = {
    id: 'guide-1',
    schemaVersion: '1.1.0',
    title: 'Test',
    type: 'guide',
    blocks: [{ type: 'markdown', id: 'm-1', content: 'hello' }],
  };
  const baseManifest = { id: 'guide-1', schemaVersion: '1.1.0', repository: 'r' };

  it('is deterministic — same input → same output', () => {
    const a = computeArtifactEtag({ content: baseContent, manifest: baseManifest });
    const b = computeArtifactEtag({ content: baseContent, manifest: baseManifest });
    expect(a).toBe(b);
  });

  it('produces a 16-char hex string', () => {
    const etag = computeArtifactEtag({ content: baseContent, manifest: baseManifest });
    expect(etag).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is invariant under key-order reshuffles (canonical-form hash)', () => {
    const reordered = {
      blocks: baseContent.blocks,
      type: baseContent.type,
      title: baseContent.title,
      schemaVersion: baseContent.schemaVersion,
      id: baseContent.id,
    };
    expect(computeArtifactEtag({ content: reordered, manifest: baseManifest })).toBe(
      computeArtifactEtag({ content: baseContent, manifest: baseManifest })
    );
  });

  it('changes when content changes (the whole point)', () => {
    const before = computeArtifactEtag({ content: baseContent, manifest: baseManifest });
    const after = computeArtifactEtag({
      content: { ...baseContent, title: 'Changed' },
      manifest: baseManifest,
    });
    expect(after).not.toBe(before);
  });

  it('changes when manifest changes', () => {
    const before = computeArtifactEtag({ content: baseContent, manifest: baseManifest });
    const after = computeArtifactEtag({
      content: baseContent,
      manifest: { ...baseManifest, repository: 'r2' },
    });
    expect(after).not.toBe(before);
  });

  it('treats undefined manifest the same as absent manifest', () => {
    const withUndef = computeArtifactEtag({ content: baseContent, manifest: undefined });
    const withAbsent = computeArtifactEtag({ content: baseContent });
    expect(withUndef).toBe(withAbsent);
  });

  it('detects array reorder — order is semantically meaningful for blocks', () => {
    const swapped = { ...baseContent, blocks: [...baseContent.blocks].reverse() };
    // Single-block array reverses to itself; use a 2-block case.
    const twoBlocks = {
      ...baseContent,
      blocks: [
        { type: 'markdown', id: 'a', content: 'first' },
        { type: 'markdown', id: 'b', content: 'second' },
      ],
    };
    const reordered = { ...twoBlocks, blocks: [...twoBlocks.blocks].reverse() };
    expect(computeArtifactEtag({ content: reordered })).not.toBe(computeArtifactEtag({ content: twoBlocks }));
    expect(computeArtifactEtag({ content: swapped })).toBe(computeArtifactEtag({ content: baseContent }));
  });
});

describe('splitArtifactEtag', () => {
  it('extracts the etag and returns the unwrapped payload', () => {
    const result = splitArtifactEtag({
      content: { id: 'x' },
      manifest: { id: 'x' },
      [ARTIFACT_ETAG_FIELD]: 'cafef00d12345678',
    });
    expect(result.etag).toBe('cafef00d12345678');
    expect(result.payload).toEqual({ content: { id: 'x' }, manifest: { id: 'x' } });
  });

  it('returns etag undefined when __etag is absent', () => {
    const result = splitArtifactEtag({ content: { id: 'x' } });
    expect(result.etag).toBeUndefined();
    expect(result.payload).toEqual({ content: { id: 'x' }, manifest: undefined });
  });

  it('ignores non-string __etag values defensively', () => {
    const result = splitArtifactEtag({
      content: { id: 'x' },
      [ARTIFACT_ETAG_FIELD]: 12345 as unknown as string,
    });
    expect(result.etag).toBeUndefined();
  });
});

describe('ETag round-trip — produce then verify', () => {
  it('a freshly-issued etag matches when computed against the same payload', () => {
    const payload = { content: { id: 'g', blocks: [] }, manifest: { id: 'g' } };
    const etag = computeArtifactEtag(payload);
    // Round-trip: send {payload, __etag}, then split-and-verify.
    const wire = { ...payload, [ARTIFACT_ETAG_FIELD]: etag };
    const { etag: receivedEtag, payload: receivedPayload } = splitArtifactEtag(wire);
    expect(receivedEtag).toBe(etag);
    expect(computeArtifactEtag(receivedPayload)).toBe(etag);
  });

  it('detects payload mutation — recomputed etag differs from the original', () => {
    const original = { content: { id: 'g', title: 'A' }, manifest: { id: 'g' } };
    const etag = computeArtifactEtag(original);
    const mutated = { content: { ...original.content, title: 'B' }, manifest: original.manifest };
    expect(computeArtifactEtag(mutated)).not.toBe(etag);
  });
});
