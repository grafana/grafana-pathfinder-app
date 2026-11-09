const isEmail = (value: string) => value.includes('@');

/** Render only; never log or send the name. */
export function getFirstName(user: { name?: string; login?: string } | undefined): string | undefined {
  const firstName = user?.name?.trim().split(/\s+/)[0];
  if (firstName && !isEmail(firstName)) {
    return firstName;
  }
  const login = user?.login?.trim();
  return login && !isEmail(login) ? login : undefined;
}
