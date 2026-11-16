/** A readable, filesystem-safe packet name. The date is the application's UTC creation date. */
export function applicationPacketName(company: string, role: string, createdAt: Date | string): string {
  const part = (value: string, fallback: string) => {
    const clean = value.normalize("NFKC").trim()
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, "-").replace(/[\s.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
    let limited = "";
    for (const character of clean) {
      if (new TextEncoder().encode(limited + character).length > 80) break;
      limited += character;
    }
    return limited.replace(/-+$/g, "") || fallback;
  };
  const date = new Date(createdAt).toISOString().slice(0, 10);
  return `${part(company, "Company")}-${part(role, "Application")}-${date}`;
}
