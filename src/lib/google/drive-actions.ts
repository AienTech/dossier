"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { action, ActionError } from "@/lib/action";
import { DRIVE_SNAPSHOT_NOTE } from "@/lib/drive-handoff";
import { saveSettings } from "@/lib/settings-data";
import { prisma } from "@/lib/prisma";
import { accessToken } from "./account";
import { archiveApplicationToDrive, hiremeDriveFolder } from "./drive";
import { GoogleError } from "./errors";

async function withDrive<T>(work: () => Promise<T>) {
  try {
    // Check the grant before spending time rendering PDFs.
    await accessToken("drive");
    return await work();
  } catch (error) {
    if (error instanceof GoogleError) throw new ActionError(error.message);
    throw error;
  }
}

export const setupDriveArchive = action(z.object({}), async () => {
  const folder = await withDrive(hiremeDriveFolder);
  await saveSettings({ driveSyncProblem: null });
  revalidatePath("/", "layout");
  return folder;
});

export const saveDriveAutoSave = action(z.object({ enabled: z.boolean() }), async ({ enabled }) => {
  await saveSettings({ driveAutoSave: enabled, ...(!enabled ? { driveSyncProblem: null } : {}) });
  revalidatePath("/", "layout");
  return null;
});

export const saveDriveShareLinks = action(z.object({ enabled: z.boolean() }), async ({ enabled }) => {
  await saveSettings({ driveShareLinks: enabled });
  revalidatePath("/", "layout");
  return null;
});

export const saveApplicationToDrive = action(z.object({ id: z.string().min(1).max(200) }), async ({ id }) => {
  const result = await withDrive(() => archiveApplicationToDrive(id));
  await prisma.note.create({ data: { applicationId: id, body: `${DRIVE_SNAPSHOT_NOTE}${result.url}` } });
  revalidatePath(`/applications/${id}`);
  return result;
});
