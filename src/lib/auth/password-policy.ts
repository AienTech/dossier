// Used when setting a new password, never to reject an existing sign-in.
export const MIN_PASSWORD_LENGTH = 16;
export const MAX_PASSWORD_LENGTH = 256;

/** A setup error without ever including the supplied password. */
export function passwordProblem(password: string): string | null {
  const length = Array.from(password).length;
  if (length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters. A password manager can generate a strong password.`;
  if (length > MAX_PASSWORD_LENGTH) return `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
  if (/^(.{1,8})\1+$/u.test(password) || !password.trim()) return "Use a unique password or passphrase, not a repeated pattern.";
  return null;
}
