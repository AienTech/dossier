import { contentDisposition } from "@/lib/file-name";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { route } from "@/lib/route";
import { readStoredFile } from "@/lib/stored-files";
export const GET = route<{ params: Promise<{ approvalId: string; key: string }> }>(async (_request, { params }) => {
  // Explicit owner check as well as route()'s session and origin checks.
  // MCP bearer tokens are not browser sessions and cannot download this file.
  if (!(await getSession())) return new Response(null, { status: 401 });
  const { approvalId, key } = await params;
  const review = await prisma.connectorApproval.findUnique({ where: { id: approvalId } });
  const files = (review?.payload as { files?: { key: string; filename: string; contentType: string }[] } | null)?.files ?? [];
  const file = files.find(x => x.key === key);
  if (!file) return new Response(null, { status: 404 });
  const data = await readStoredFile("approval-attachments", key);
  return data ? new Response(data, { headers: { "Content-Type": file.contentType, "Content-Disposition": contentDisposition(file.filename), "Cache-Control": "private, no-store" } }) : new Response(null, { status: 404 });
});
