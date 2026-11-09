/**
 * The signed-in user's name for attributing a guide they author: `name`,
 * falling back to `login`.
 *
 * Only these two fields are read. `email` and `gravatarUrl` identify a person
 * beyond the display name the author chose to be known by, so they never reach
 * a guide manifest.
 */

import { config } from '@grafana/runtime';

function nonBlank(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export function currentUserAuthorName(): string | undefined {
  const user = config.bootData?.user;
  return nonBlank(user?.name) ?? nonBlank(user?.login);
}
