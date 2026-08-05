/**
 * Guide ID derivation.
 *
 * The ID is what `toResourceName` turns into the backend resource name, so two
 * guides that share an ID collide in the library. Both places that can leave a
 * guide on the default placeholder — the title commit and the first save — mint
 * through here.
 */

/** Converts a guide title to a URL-safe kebab-case slug. */
export function slugifyTitle(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'guide'
  );
}

/** Generates a unique guide ID from a title, avoiding collisions with existing resource names. */
export function generateUniqueId(title: string, existingNames: string[] = []): string {
  const base = slugifyTitle(title);
  for (let i = 0; i < 20; i++) {
    const suffix = Math.random().toString(36).slice(2, 6);
    const candidate = `${base}-${suffix}`;
    if (!existingNames.includes(candidate)) {
      return candidate;
    }
  }
  return `${base}-${Date.now().toString(36).slice(-6)}`;
}
