import { normalizeBlockInput } from '../utils/input-normalizers';

describe('normalizeBlockInput', () => {
  describe('non-video block types — passthrough', () => {
    it('returns the input unchanged with no warnings for markdown', () => {
      const fields = { content: 'hello' };
      const result = normalizeBlockInput('markdown', fields);
      expect(result.normalized).toBe(fields);
      expect(result.warnings).toEqual([]);
    });

    it('returns the input unchanged with no warnings for unknown block types', () => {
      const fields = { foo: 'bar' };
      const result = normalizeBlockInput('mystery-future-type', fields);
      expect(result.normalized).toBe(fields);
      expect(result.warnings).toEqual([]);
    });
  });

  describe('video — YouTube URL forms', () => {
    const ID = 'dQw4w9WgXcQ';
    const embed = `https://www.youtube.com/embed/${ID}`;

    it('rewrites a youtube.com/watch URL to the embed form', () => {
      const result = normalizeBlockInput('video', { src: `https://www.youtube.com/watch?v=${ID}` });
      expect(result.normalized.src).toBe(embed);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]?.code).toBe('INPUT_NORMALIZED');
      expect(result.warnings[0]?.message).toContain(ID);
      expect(result.warnings[0]?.path).toBe('src');
    });

    it('rewrites a youtu.be short URL to the embed form', () => {
      const result = normalizeBlockInput('video', { src: `https://youtu.be/${ID}` });
      expect(result.normalized.src).toBe(embed);
      expect(result.warnings).toHaveLength(1);
    });

    it('rewrites a youtube.com/shorts URL to the embed form', () => {
      const result = normalizeBlockInput('video', { src: `https://www.youtube.com/shorts/${ID}` });
      expect(result.normalized.src).toBe(embed);
      expect(result.warnings).toHaveLength(1);
    });

    it('tolerates missing protocol on a watch URL', () => {
      const result = normalizeBlockInput('video', { src: `www.youtube.com/watch?v=${ID}` });
      expect(result.normalized.src).toBe(embed);
      expect(result.warnings).toHaveLength(1);
    });

    it('tolerates m.youtube.com (mobile) host', () => {
      const result = normalizeBlockInput('video', { src: `https://m.youtube.com/watch?v=${ID}` });
      expect(result.normalized.src).toBe(embed);
    });

    it('preserves extra fields on the block input', () => {
      const result = normalizeBlockInput('video', {
        src: `https://www.youtube.com/watch?v=${ID}`,
        start: 30,
        end: 60,
      });
      expect(result.normalized.src).toBe(embed);
      expect(result.normalized.start).toBe(30);
      expect(result.normalized.end).toBe(60);
    });

    it('does NOT rewrite an already-embed URL — no warning emitted', () => {
      const result = normalizeBlockInput('video', { src: embed });
      expect(result.normalized.src).toBe(embed);
      expect(result.warnings).toEqual([]);
    });

    it('leaves non-YouTube URLs untouched — the validator will catch them', () => {
      const result = normalizeBlockInput('video', { src: 'https://example.com/video.mp4' });
      expect(result.normalized.src).toBe('https://example.com/video.mp4');
      expect(result.warnings).toEqual([]);
    });

    it('leaves malformed URL strings untouched', () => {
      const result = normalizeBlockInput('video', { src: 'not a url' });
      expect(result.normalized.src).toBe('not a url');
      expect(result.warnings).toEqual([]);
    });

    it('skips when src is absent', () => {
      const result = normalizeBlockInput('video', {});
      expect(result.warnings).toEqual([]);
    });

    it('skips when src is empty', () => {
      const result = normalizeBlockInput('video', { src: '' });
      expect(result.warnings).toEqual([]);
    });

    it('rejects implausibly short video ids (under 6 chars) as a guard against false positives', () => {
      // A 5-character path on youtu.be is unlikely to be a real video id —
      // err on the safe side and leave it untouched so the validator can
      // surface the real problem.
      const result = normalizeBlockInput('video', { src: 'https://youtu.be/short' });
      expect(result.warnings).toEqual([]);
    });
  });

  describe('video — Vimeo URL forms', () => {
    const embed = 'https://player.vimeo.com/video/76979871';

    it('rewrites a vimeo.com/<id> URL to the player embed form', () => {
      const result = normalizeBlockInput('video', { src: 'https://vimeo.com/76979871' });
      expect(result.normalized.src).toBe(embed);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]?.code).toBe('INPUT_NORMALIZED');
      expect(result.warnings[0]?.path).toBe('src');
    });

    it('carries the unlisted hash into the h query param', () => {
      const result = normalizeBlockInput('video', { src: 'https://vimeo.com/76979871/abc123def' });
      expect(result.normalized.src).toBe('https://player.vimeo.com/video/76979871?h=abc123def');
      expect(result.warnings).toHaveLength(1);
    });

    it('rewrites a channel URL to the player embed form', () => {
      const result = normalizeBlockInput('video', { src: 'https://vimeo.com/channels/staffpicks/76979871' });
      expect(result.normalized.src).toBe(embed);
    });

    it('picks the video id (last numeric segment) from a group URL', () => {
      const result = normalizeBlockInput('video', { src: 'https://vimeo.com/groups/98765/videos/76979871' });
      expect(result.normalized.src).toBe(embed);
    });

    it('tolerates missing protocol and www host', () => {
      const result = normalizeBlockInput('video', { src: 'www.vimeo.com/76979871' });
      expect(result.normalized.src).toBe(embed);
    });

    it('does NOT rewrite an already-embed player URL — no warning emitted', () => {
      const result = normalizeBlockInput('video', { src: embed });
      expect(result.normalized.src).toBe(embed);
      expect(result.warnings).toEqual([]);
    });

    it('leaves a Vimeo URL without a numeric id untouched', () => {
      const result = normalizeBlockInput('video', { src: 'https://vimeo.com/user/settings' });
      expect(result.warnings).toEqual([]);
    });
  });
});
