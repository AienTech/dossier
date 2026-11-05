/** The link a resume can open: http(s) only, with "https://" added when it's missing; null for anything else. */
export function webHref(link: string): string | null {
  const value = link.trim();
  if (!value) return null;
  const withScheme = /^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}
