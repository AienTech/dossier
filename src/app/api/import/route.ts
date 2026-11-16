import { promisify } from "node:util";
import { gunzip } from "node:zlib";

import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { JobStatus } from "@/generated/prisma/enums";
import { writeBackup } from "@/lib/backups";
import { currentSummary, importExport, parseExport, summarizeExport } from "@/lib/data-import";
import { freezeSentApplications } from "@/lib/frozen-copy";
import { IMPORT_MAX_BYTES, IMPORT_TOO_BIG } from "@/lib/import-limits";
import { cancelJob } from "@/lib/jobs/runner";
import { prisma } from "@/lib/prisma";
import { route } from "@/lib/route";

const unzip = promisify(gunzip);

/** Bound both the upload and its expanded size before parsing an export. */
async function importText(request: Request): Promise<string> {
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > IMPORT_MAX_BYTES) {
        await reader.cancel();
        throw new RangeError(IMPORT_TOO_BIG);
      }
      chunks.push(value);
    }
  }
  const bytes = Buffer.concat(chunks);
  const decoded = request.headers.get("content-encoding") === "gzip"
    ? await unzip(bytes, { maxOutputLength: IMPORT_MAX_BYTES })
    : bytes;
  return decoded.toString("utf8");
}

/**
 * Restores from an export file (E10-6, SET-10), sent as the request body.
 * A route handler rather than a Server Action, whose body limit is 1 MB;
 * the proxy still caps bodies at 10 MB (see DEVELOPMENT.md). `?preview=1` only reads
 * the file and says what it would replace. Otherwise the current data is
 * backed up to HIREME_DATA_DIR/backups first, then replaced in one go.
 */
export const POST = route(async (request) => {
  // Past the proxy's limit a body arrives cut off, so refuse it up front.
  if (Number(request.headers.get("content-length") ?? 0) > IMPORT_MAX_BYTES) {
    return NextResponse.json({ error: IMPORT_TOO_BIG }, { status: 413 });
  }
  const encoding = request.headers.get("content-encoding");
  if (encoding && encoding !== "identity" && encoding !== "gzip") {
    return NextResponse.json({ error: "That upload's compression isn't supported." }, { status: 415 });
  }
  let text: string;
  try {
    text = await importText(request);
  } catch (error) {
    const tooBig = error instanceof RangeError || (error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE";
    return NextResponse.json({ error: tooBig ? IMPORT_TOO_BIG : "That compressed export is damaged or incomplete." }, { status: tooBig ? 413 : 400 });
  }
  const parsed = parseExport(text);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const incoming = summarizeExport(parsed.data);

  if (request.nextUrl.searchParams.get("preview") === "1") {
    return NextResponse.json({ incoming, current: await currentSummary(prisma), exportedAt: parsed.data.exportedAt });
  }

  // Work in progress would write into data that's about to be replaced.
  const unfinished = await prisma.job.findMany({ where: { status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] } }, select: { id: true } });
  for (const job of unfinished) await cancelJob(job.id);

  const backup = await writeBackup("before-import");
  await importExport(prisma, parsed.data);
  // A file from before 1.12 has no copies of what its sent applications were sent with (#299).
  await freezeSentApplications();
  revalidatePath("/", "layout");
  return NextResponse.json({ incoming, backup });
});
