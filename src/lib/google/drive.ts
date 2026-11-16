import "server-only";

import { randomUUID } from "node:crypto";
import { unzipSync } from "fflate";

import { buildApplyPacket } from "@/lib/apply-packet";
import { packetBotPrompt } from "@/lib/drive-handoff";
import { loadSettings } from "@/lib/settings-data";
import { googleFetch } from "./account";
import { googleUrl } from "./endpoints";

const FOLDER = "application/vnd.google-apps.folder";
type DriveFile = { id: string; name?: string };
const folderUrl = (id: string) => `https://drive.google.com/drive/folders/${encodeURIComponent(id)}`;
const quote = (value: string) => value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

async function ensureFolder(name: string, key: string, parent?: string): Promise<DriveFile> {
  const url = new URL(googleUrl("www", "/drive/v3/files"));
  url.searchParams.set("q", `trashed = false and mimeType = '${FOLDER}' and appProperties has { key='hiremeFolder' and value='${quote(key)}' }${parent ? ` and '${quote(parent)}' in parents` : " and 'root' in parents"}`);
  url.searchParams.set("fields", "files(id,name)");
  url.searchParams.set("pageSize", "1");
  const result = await googleFetch<{ files: DriveFile[] }>("drive", url);
  if (result.files[0]) {
    const existing = result.files[0];
    // Keep the tagged folder and its history, including when upgrading old ID names.
    if (existing.name && existing.name !== name) await googleFetch("drive", googleUrl("www", `/drive/v3/files/${encodeURIComponent(existing.id)}?fields=id`), { method: "PATCH", body: { name } });
    return existing;
  }
  return googleFetch<DriveFile>("drive", googleUrl("www", "/drive/v3/files?fields=id"), {
    method: "POST", body: { name, mimeType: FOLDER, appProperties: { hiremeFolder: key }, parents: [parent || "root"] },
  });
}

/** Only folders created by this OAuth client are visible with drive.file. */
export async function hiremeDriveFolder() {
  const folder = await ensureFolder("HireMe", "root");
  return { id: folder.id, url: folderUrl(folder.id) };
}

async function upload(parent: string, name: string, bytes: Uint8Array) {
  const boundary = `hireme_${randomUUID()}`;
  const mime = name.endsWith(".pdf") ? "application/pdf" : "text/markdown; charset=utf-8";
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify({ name, parents: [parent] }),
    `\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,
    Buffer.from(bytes), `\r\n--${boundary}--\r\n`,
  ]);
  return googleFetch<DriveFile>("drive", googleUrl("www", "/upload/drive/v3/files?uploadType=multipart&fields=id"), {
    method: "POST", media: { body, contentType: `multipart/related; boundary=${boundary}` },
  });
}

/** Append a dated snapshot; never replace earlier PDFs or grant public access. */
export async function archiveApplicationToDrive(applicationId: string, verifySource?: () => Promise<void>) {  // Validate and render everything before creating an archive folder.
  const { packet, zip, promptContext } = await buildApplyPacket(applicationId);
  await verifySource?.();
  const files = unzipSync(zip);
  const root = await hiremeDriveFolder();
  const application = await ensureFolder(packet.folderName || applicationId, applicationId, root.id);
  const name = `${new Date().toISOString().replace(/:/g, "-")} ${randomUUID().slice(0, 8)}`;
  const snapshot = await googleFetch<DriveFile>("drive", googleUrl("www", "/drive/v3/files?fields=id"), {
    method: "POST", body: { name: `${name} (incomplete)`, mimeType: FOLDER, parents: [application.id] },
  });
  if (promptContext) files[`${packet.folderName || applicationId}/bot-prompt.md`] = new TextEncoder().encode(packetBotPrompt({ ...promptContext.input, snapshotUrl: folderUrl(snapshot.id) }, promptContext.notes));
  // Keep partial failures visibly incomplete; the UI only reports success after all files finish.
  for (const file of packet.files) await upload(snapshot.id, file, files[`${packet.folderName || applicationId}/${file}`]);
  await googleFetch("drive", googleUrl("www", `/drive/v3/files/${encodeURIComponent(snapshot.id)}?fields=id`), {
    method: "PATCH", body: { name },
  });
  // Only a finished snapshot is ever link-readable, and only when the owner
  // turned that on. The folder above it stays private.
  if ((await loadSettings()).driveShareLinks) {
    await googleFetch("drive", googleUrl("www", `/drive/v3/files/${encodeURIComponent(snapshot.id)}/permissions?fields=id`), {
      method: "POST", body: { role: "reader", type: "anyone", allowFileDiscovery: false },
    });
  }
  return { url: folderUrl(snapshot.id), files: packet.files };
}
