/**
 * Utility functions for hashing sensitive data
 */

/**
 * Hash a string using SHA-256 (browser-compatible)
 * @param input - The string to hash
 * @returns Promise<string> - The hashed string as hex
 */
export const hashString = async (input: string): Promise<string> => {
  // Use the Web Crypto API for secure hashing
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);

  // Convert buffer to hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

  return hashHex;
};

/**
 * Hash user identification data (user_id and email)
 * @param userId - The user ID to hash
 * @param email - The email to hash
 * @returns Promise<{hashedUserId: string, hashedEmail: string}>
 */
export const hashUserData = async (
  userId: string,
  email: string
): Promise<{
  hashedUserId: string;
  hashedEmail: string;
}> => {
  const [hashedUserId, hashedEmail] = await Promise.all([hashString(userId), hashString(email)]);

  return {
    hashedUserId,
    hashedEmail,
  };
};
