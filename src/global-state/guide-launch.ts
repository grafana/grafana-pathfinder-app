/**
 * Module-owned staging area for prepared (one-fetch) launch payloads.
 *
 * `prepareGuideLaunch` produces trusted, already-validated content. The
 * launch handoff sometimes has to cross PUBLIC channels — the
 * `pathfinder-auto-open-docs` CustomEvent and the cold-sidebar link queue —
 * that any same-page script can also write to. The payload itself must never
 * ride those channels: a forged `preparedContent` would bypass the fetch
 * pipeline's URL/HTTPS/package validation, and a forged `packageInfo` is
 * persisted with the tab and controls render type.
 *
 * Instead, the producer stages the payload here and sends only an opaque,
 * unguessable `launchKey` over the public channel. The consumer redeems the
 * key at the trusted boundary. A forged, replayed, stale, or URL-mismatched
 * key redeems to `null`, and the loader falls back to its normal validated
 * fetch — exactly the pre-prepared-launch behavior.
 *
 * (The `panelModeManager.setPendingGuide` handoff channel is already
 * module-owned memory and never crosses a public boundary, so it carries its
 * payload directly.)
 */

import type { PackageOpenInfo } from '../types/content-panel.types';
import type { RawContent } from '../types/content.types';

export interface StagedLaunchPayload {
  /** URL the payload was prepared for — redemption requires an exact match. */
  url: string;
  /** @see OpenDocsOptions.preparedContent */
  preparedContent: RawContent;
  /** @see OpenDocsOptions.packageInfo */
  packageInfo?: PackageOpenInfo;
}

/**
 * Redemption deadline. The public channels drain within milliseconds (event)
 * or as soon as the cold sidebar mounts and replays its queue (seconds); a
 * minute-old key means the launch was abandoned, and falling back to a fresh
 * fetch is safer than rendering stale content.
 */
const STALE_AFTER_MS = 60_000;

class GuideLaunchStore {
  private _staged = new Map<string, { payload: StagedLaunchPayload; stagedAt: number }>();

  /**
   * Stage a prepared payload and get back the opaque key to send over the
   * public channel. Keys are single-use. Expired entries are swept here —
   * redemption is the only other eviction path, and an abandoned launch's
   * key is exactly the one that never gets redeemed, so without the sweep
   * each abandoned launch would retain a full expanded guide for the life
   * of the page.
   */
  public stage(payload: StagedLaunchPayload): string {
    const now = Date.now();
    for (const [key, entry] of this._staged) {
      if (now - entry.stagedAt > STALE_AFTER_MS) {
        this._staged.delete(key);
      }
    }
    const key = crypto.randomUUID();
    this._staged.set(key, { payload, stagedAt: now });
    return key;
  }

  /**
   * Redeem a key received from a public channel. Consume-once: the entry is
   * removed whether or not redemption succeeds. Returns `null` (caller falls
   * back to a normal fetch) for unknown/forged keys, replays, stale entries,
   * and keys redeemed against a different URL than they were staged for —
   * that last check stops a same-page script from re-attaching a genuine
   * key to attacker-chosen content coordinates.
   */
  public consume(key: string | undefined, url: string): StagedLaunchPayload | null {
    if (!key) {
      return null;
    }
    const entry = this._staged.get(key);
    if (!entry) {
      return null;
    }
    this._staged.delete(key);
    if (Date.now() - entry.stagedAt > STALE_AFTER_MS) {
      return null;
    }
    if (entry.payload.url !== url) {
      return null;
    }
    return entry.payload;
  }
}

export const guideLaunchStore = new GuideLaunchStore();
