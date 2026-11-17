import { type NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { contentDisposition } from "@/lib/file-name";
import { isApplyPacketPassword } from "@/lib/apply-packet-access";
import { prisma } from "@/lib/prisma";
import { isSameOrigin } from "@/lib/route";
import { publicOrigin } from "@/lib/google/origin";
import { buildApplyPacket } from "@/lib/apply-packet";
import { logServerError } from "@/lib/log";
import { messages } from "@/lib/messages";
import { unstable_rethrow } from "next/navigation";

/**
 * ZIP apply packet: signed-in same-origin download, or the shared
 * HIREME_APPLY_PACKET_PASSWORD for Grok / OpenBot (cross-origin GET allowed
 * only with that password). Checks access itself (see session-audit OPEN_ROUTES).
 */
export async function GET(request: NextRequest, { params }: RouteContext<"/api/apply-packets/[id]">) {
  const passwordOk = isApplyPacketPassword(request);
  const session = passwordOk ? null : await getSession();
  if (!passwordOk && !session) {
    return NextResponse.json({ error: messages.signedOut }, { status: 401, headers: { "cache-control": "private, no-store" } });
  }
  if (!passwordOk && !isSameOrigin(request)) {
    return NextResponse.json({ error: messages.crossOrigin }, { status: 403, headers: { "cache-control": "private, no-store" } });
  }

  try {
    const { id } = await params;
    const application = await prisma.application.findUnique({ where: { id, awaitingReview: false }, select: { id: true } });
    if (!application) {
      return NextResponse.json({ error: "That application no longer exists." }, { status: 404, headers: { "cache-control": "private, no-store" } });
    }
    const { packet, zip: data } = await buildApplyPacket(id, "download", publicOrigin(request));
    return new Response(Buffer.from(data), {
      headers: {
        "content-type": "application/zip",
        "content-disposition": contentDisposition(packet.archiveName || `hireme-apply-${id}.zip`),
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    unstable_rethrow(error);
    logServerError(`${request.method} ${request.nextUrl.pathname}`, error);
    return NextResponse.json({ error: messages.unexpected }, { status: 500, headers: { "cache-control": "private, no-store" } });
  }
}
