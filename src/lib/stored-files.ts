import "server-only";

import { prisma } from "@/lib/prisma";

// Cloud instances have no shared disk. These private artifacts live alongside
// the application's data, never at public asset URLs. They are intentionally
// excluded from data exports to avoid recursively backing up old backups.
export type FileGroup = "backups" | "downloads" | "apply-packets" | "submission-files" | "approval-attachments";

function fileKey(group: FileGroup, name: string): string {
  if (!name || !/^[a-zA-Z0-9_.-]+$/.test(name) || name === "." || name === "..") throw new Error("Invalid file name.");
  return `${group}/${name}`;
}

export async function storeFile(group: FileGroup, name: string, data: Uint8Array, modified = new Date()): Promise<void> {
  const key = fileKey(group, name);
  const bytes = new Uint8Array(data);
  await prisma.storedFile.upsert({ where: { key }, create: { key, data: bytes, modified }, update: { data: bytes, modified } });
}

export async function readStoredFile(group: FileGroup, name: string): Promise<Uint8Array<ArrayBuffer> | null> {
  const file = await prisma.storedFile.findUnique({ where: { key: fileKey(group, name) }, select: { data: true } });
  return file ? new Uint8Array(file.data) : null;
}

export async function listStoredFiles(group: FileGroup): Promise<{ name: string; modified: Date }[]> {
  const prefix = `${group}/`;
  const files = await prisma.storedFile.findMany({ where: { key: { startsWith: prefix } }, select: { key: true, modified: true }, orderBy: { modified: "desc" } });
  return files.map(({ key, modified }) => ({ name: key.slice(prefix.length), modified }));
}

export async function deleteStoredFile(group: FileGroup, name: string): Promise<void> {
  await prisma.storedFile.deleteMany({ where: { key: fileKey(group, name) } });
}

export async function deleteStoredFiles(group: FileGroup, before?: Date): Promise<void> {
  await prisma.storedFile.deleteMany({ where: { key: { startsWith: `${group}/` }, ...(before ? { modified: { lt: before } } : {}) } });
}
