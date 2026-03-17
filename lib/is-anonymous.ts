/**
 * Detects anonymous/temporary users by checking name and email patterns.
 * Works with session user objects, API responses, or any object with name/email.
 */
export function isAnonymousUser(
  user: { name?: string | null; email?: string | null } | null | undefined
): boolean {
  if (!user) {
    return true;
  }
  return (
    user.name === "Anonymous" ||
    Boolean(user.email?.includes("@http://")) ||
    Boolean(user.email?.includes("@https://")) ||
    Boolean(user.email?.startsWith("temp-"))
  );
}
