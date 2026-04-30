/**
 * Auto-id generation for the `create` command.
 *
 * The default package id has the form `<kebab-of-title>-<6-char-base32-suffix>`.
 * The suffix uses Crockford-style base32 minus visually ambiguous chars
 * (0/O, 1/I/L) so the resulting id is unambiguous when the user reads it
 * back from a URL or commit message. Six characters of entropy is enough to
 * make collisions in any single App Platform namespace statistically
 * negligible without a pre-publish lookup.
 *
 * See [docs/design/AGENT-AUTHORING.md#auto-assignment-of-ids].
 */

import { randomBytes } from 'crypto';

import { PACKAGE_ID_MAX_LENGTH, PACKAGE_ID_REGEX } from '../../types/package.schema';

const SUFFIX_ALPHABET = 'abcdefghjkmnpqrstvwxyz23456789';
const SUFFIX_LENGTH = 6;

/**
 * Convert a free-text title into a kebab-case slug.
 *
 * Lowercases, strips diacritics, replaces every run of non-alphanumeric
 * characters with a single hyphen, trims hyphens off the ends, and clamps
 * to a sensible length so the final id (with suffix) stays under
 * `PACKAGE_ID_MAX_LENGTH`.
 */
export function kebabOfTitle(title: string): string {
  const stripped = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  // Reserve room for `-` plus the 6-char suffix; clip so Kubernetes-style
  // resource names can never overflow even for adversarial titles.
  const slugBudget = PACKAGE_ID_MAX_LENGTH - SUFFIX_LENGTH - 1;
  return stripped.slice(0, Math.max(slugBudget, 1)).replace(/-+$/g, '');
}

/**
 * Generate `SUFFIX_LENGTH` characters from a reduced base32 alphabet.
 *
 * Reads cryptographically secure bytes via `crypto.randomBytes` so the same
 * title can be invoked thousands of times across distributed agents without
 * meaningful collision risk in any one App Platform namespace.
 */
export function randomBase32Suffix(rng: () => Buffer = () => randomBytes(SUFFIX_LENGTH)): string {
  const bytes = rng();
  let out = '';
  for (let i = 0; i < SUFFIX_LENGTH; i++) {
    const byte = bytes[i] ?? 0;
    out += SUFFIX_ALPHABET[byte % SUFFIX_ALPHABET.length] ?? 'x';
  }
  return out;
}

/**
 * Compose the full default package id. Verifies the result matches
 * `PACKAGE_ID_REGEX` so a degenerate title (e.g. all punctuation) doesn't
 * silently produce an invalid id — the caller must instead pass `--id`
 * explicitly.
 */
export function defaultPackageId(title: string, rng?: () => Buffer): string {
  const slug = kebabOfTitle(title);
  if (slug.length === 0) {
    throw new Error(
      'Title produced an empty slug — pass --id explicitly. Titles need at least one alphanumeric character to auto-generate an id.'
    );
  }
  const id = `${slug}-${randomBase32Suffix(rng)}`;
  if (!PACKAGE_ID_REGEX.test(id)) {
    throw new Error(`Generated id "${id}" failed the package-id regex (this is a bug — pass --id explicitly).`);
  }
  return id;
}
