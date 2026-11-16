import { NextResponse } from "next/server";

import { contentDisposition } from "@/lib/file-name";
import { prisma } from "@/lib/prisma";
import { route } from "@/lib/route";
import { publicOrigin } from "@/lib/google/origin";
import { buildApplyPacket } from "@/lib/apply-packet";

/** Private cloud handoff: no public or token-in-URL links to the user's CV. */
export const GET = route<RouteContext<"/api/apply-packets/[id]">>(async (request, { params }) => {
  const { id } = await params;
  const application = await prisma.application.findUnique({ where: { id, awaitingReview: false }, select: { id: true } });
  if (!application) return NextResponse.json({ error: "That application no longer exists." }, { status: 404 });
  const { packet, zip: data } = await buildApplyPacket(id, "download", publicOrigin(request));
  return new Response(Buffer.from(data), { headers: { "content-type": "application/zip", "content-disposition": contentDisposition(packet.archiveName || `hireme-apply-${id}.zip`) } });
});
