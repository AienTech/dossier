import { contentDisposition } from "@/lib/file-name";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { route } from "@/lib/route";
import { readStoredFile } from "@/lib/stored-files";
export const GET = route<{ params: Promise<{ applicationId: string; key: string }> }>(async (_request, { params }) => {
  // The normal owner session is required; an MCP bearer token is insufficient.
  if (!(await getSession())) return new Response(null, { status: 401 });
  const { applicationId, key } = await params;
  const app = await prisma.application.findUnique({ where: { id: applicationId }, select: { submission: true } });
  const file = (app?.submission as { documents?: { file_key?: string; filename?: string; content_type?: string }[] } | null)?.documents?.find(x => x.file_key === key);
  if (!file) return new Response(null, { status: 404 });
  const data = await readStoredFile("submission-files", key);
  return data ? new Response(data, { headers: { "Content-Type": file.content_type ?? "application/octet-stream", "Content-Disposition": contentDisposition(file.filename ?? "submitted-document"), "Cache-Control": "private, no-store" } }) : new Response(null, { status: 404 });
});
