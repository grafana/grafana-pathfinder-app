/**
 * CLI-side input normalization (M3 — see
 * [`docs/design/MCP-AGENT-UX-HARDENING.md`](../../../docs/design/MCP-AGENT-UX-HARDENING.md)).
 *
 * Where a field has a known canonical form, rewrite the user-supplied
 * value into that form in the CLI runner and emit a soft
 * `INPUT_NORMALIZED` warning naming what was rewritten. The alternative
 * (fail → agent retries → maybe fixes it) wastes one full hop of context
 * per non-canonical input and trains the agent that the canonical form is
 * a guess rather than a contract.
 *
 * Normalizers are pure functions of `(blockType, fields)` returning
 * `{ normalized, warnings }`. Composing more normalizers means adding a
 * branch here — the runner side does not need to change.
 *
 * Current normalizers:
 *
 * - `video.src` — YouTube watch / short / shorts URLs → embed form
 *   (hardening doc issue #2), and Vimeo watch URLs → player embed form.
 *
 * Candidates for future slices: trailing slashes on URLs; whitespace
 * trimming on titles and descriptions; slug-ification of package ids
 * when an agent passes a human title verbatim.
 */

import type { OutcomeWarning } from './output';
import { inputNormalizedWarning } from './warnings';

/**
 * Apply every known normalizer for a block type. Returns the (possibly
 * rewritten) field record and a list of warnings naming each rewrite.
 *
 * The returned object aliases the input when no rewrite happened — call
 * sites should treat `normalized` as the canonical form to use downstream
 * regardless. Warnings are an empty array when nothing changed.
 */
export function normalizeBlockInput(
  blockType: string,
  fields: Record<string, unknown>
): { normalized: Record<string, unknown>; warnings: OutcomeWarning[] } {
  if (blockType === 'video') {
    return normalizeVideoFields(fields);
  }
  return { normalized: fields, warnings: [] };
}

// ---------------------------------------------------------------------------
// video — YouTube URL forms
// ---------------------------------------------------------------------------

// YouTube video ids are 11 chars in practice. We accept 6-15 to tolerate any
// historical or future variant without matching pathologically long strings —
// the upper bound rejects junk that happens to share YouTube's alphabet.
const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{6,15}$/;

/**
 * Recognize the three common non-embed YouTube URL forms and return the
 * extracted video id. Returns `null` if the URL is not a non-embed YouTube
 * URL (so the caller can leave it untouched and let the validator decide).
 *
 * Forms recognized:
 * - `https://www.youtube.com/watch?v=<id>` (and `m.youtube.com`, missing
 *   protocol, extra query params)
 * - `https://youtu.be/<id>` (short form)
 * - `https://www.youtube.com/shorts/<id>`
 *
 * Already-embed URLs (`/embed/<id>`) are not handled here — they pass
 * through `normalizeVideoFields` unchanged.
 */
function extractYoutubeId(url: string): string | null {
  let parsed: URL;
  try {
    // Tolerate missing protocol by giving URL() a base hint. If the user
    // typed `youtube.com/...` we still want to recognize it.
    parsed = new URL(/^https?:\/\//.test(url) ? url : `https://${url}`);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^www\./, '').replace(/^m\./, '');
  if (host === 'youtu.be') {
    const id = parsed.pathname.slice(1).split('/')[0] ?? '';
    return YOUTUBE_ID_PATTERN.test(id) ? id : null;
  }
  if (host === 'youtube.com') {
    if (parsed.pathname === '/watch') {
      const id = parsed.searchParams.get('v') ?? '';
      return YOUTUBE_ID_PATTERN.test(id) ? id : null;
    }
    if (parsed.pathname.startsWith('/shorts/')) {
      const id = parsed.pathname.slice('/shorts/'.length).split('/')[0] ?? '';
      return YOUTUBE_ID_PATTERN.test(id) ? id : null;
    }
    // Already-embed URLs return null here so the caller leaves them alone.
  }
  return null;
}

// Vimeo ids are numeric; unlisted videos carry an alphanumeric hash.
const VIMEO_ID_PATTERN = /^\d+$/;
const VIMEO_HASH_PATTERN = /^[A-Za-z0-9]+$/;

/**
 * Recognize the common Vimeo watch URL forms and return the canonical player
 * embed URL. Returns `null` if the URL is not a non-embed Vimeo URL (so the
 * caller leaves it untouched).
 *
 * Forms recognized:
 * - `https://vimeo.com/<id>` (and `www.vimeo.com`, missing protocol)
 * - `https://vimeo.com/<id>/<hash>` (unlisted) → `?h=<hash>`
 * - `https://vimeo.com/channels/<name>/<id>`
 *
 * Already-embed URLs (`player.vimeo.com/video/<id>`) return null here so the
 * caller leaves them alone.
 */
function extractVimeoEmbed(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//.test(url) ? url : `https://${url}`);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^www\./, '');
  if (host !== 'vimeo.com') {
    return null;
  }
  const segments = parsed.pathname.split('/').filter(Boolean);
  // The video id is the LAST numeric segment; a preceding numeric (e.g.
  // /groups/<gid>/videos/<id>) is a collection id, not the video.
  const numeric = segments.filter((s) => VIMEO_ID_PATTERN.test(s));
  const id = numeric[numeric.length - 1];
  if (!id) {
    return null;
  }
  const hash = segments[segments.indexOf(id) + 1];
  const embed = new URL(`https://player.vimeo.com/video/${id}`);
  if (hash && VIMEO_HASH_PATTERN.test(hash)) {
    embed.searchParams.set('h', hash);
  }
  return embed.toString();
}

function normalizeVideoFields(fields: Record<string, unknown>): {
  normalized: Record<string, unknown>;
  warnings: OutcomeWarning[];
} {
  const src = fields.src;
  if (typeof src !== 'string' || src.length === 0) {
    return { normalized: fields, warnings: [] };
  }

  const youtubeId = extractYoutubeId(src);
  if (youtubeId !== null) {
    const canonical = `https://www.youtube.com/embed/${youtubeId}`;
    if (canonical === src) {
      return { normalized: fields, warnings: [] };
    }
    return {
      normalized: { ...fields, src: canonical },
      warnings: [inputNormalizedWarning('src', src, canonical)],
    };
  }

  const vimeoEmbed = extractVimeoEmbed(src);
  if (vimeoEmbed !== null && vimeoEmbed !== src) {
    return {
      normalized: { ...fields, src: vimeoEmbed },
      warnings: [inputNormalizedWarning('src', src, vimeoEmbed)],
    };
  }

  return { normalized: fields, warnings: [] };
}
